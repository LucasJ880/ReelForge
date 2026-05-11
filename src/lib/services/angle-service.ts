import { Prisma, AngleType } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJsonByTier, isLLMAvailable } from "@/lib/providers/openai";
import {
  BLANKET_THEME_POOL,
  pickExplorationThemes,
  type ExplorationTheme,
} from "@/lib/config/blanket-themes";

const SYSTEM_PROMPT = `You are a senior short-form video ad strategist for TikTok / Reels / Shorts (vertical 9:16).
Your job: for one selling point, produce 5 distinct ad angles (3 OPTIMIZATION + 2 EXPLORATION) that a small business owner can actually shoot or have AI render.

You will receive:
- The selling point (title + body + localizations)
- Structured product input (category, audience, price, brand_tone, real footage notes)
- The client's uploaded real footage list + notes (productInput.footage_assets / footage_notes)
- Target country / language
- 3 OPTIMIZATION slots — must build on the previous round's distillation if provided; otherwise grounded in research + selling point
- 2 EXPLORATION slots — each with a pre-assigned theme key you MUST honor

OUTPUT JSON ONLY:
{
  "angles": [
    {
      "type": "OPTIMIZATION" | "EXPLORATION",
      "sort_order": 1,
      "title": "<= 12 words, in English, NO emojis",
      "hook": "First 1-3 seconds: visual + opening line. Concrete, sensory, vertical-friendly.",
      "narrative": "30-50 words. Specify pacing across hook → proof → CTA.",
      "exploration_theme": "EXPLORATION only — must equal the input theme key",
      "locale_notes": {
        "target_language": "<copied from input>",
        "target_audience_pain_point": "ONE specific pain this angle solves (8-15 words)",
        "primary_cta": "Call-to-action verb + offer (e.g. 'Tap to see how it works')",
        "on_camera_recommendation": "NONE | PRODUCT_ONLY | SELF_RAW | SELF_VOICE_REPLACED | SELF_SUBTITLED | UGC_AVATAR",
        "cultural_notes": "1-2 sentence cultural fit note",
        "footage_pick": "Which real footage / shot types to prioritize (1-2 sentences)",
        "missing_footage": "If a critical shot is missing, list what to capture; otherwise empty string"
      }
    }
  ]
}

HARD REQUIREMENTS — failing any one of these is a failure:
1. OPTIMIZATION sort_order 1, 2, 3. EXPLORATION sort_order 4, 5.
2. The 5 angles must be DISTINCT across ALL of: hook structure, narrative arc, target pain point, CTA wording, and visual concept.
   Forbidden: 5 versions of "comfort for everyone" / 5 versions of "luxury for less" / 5 versions of the same hook with synonyms.
3. Hook must be VISUAL first. Show, don't tell. Examples that pass: "Hand reaches up to a cord that isn't there"; "Toddler walks into the room — blinds glide down on their own".
   Examples that fail: "Discover the future of window treatments" / "Welcome to the new era of comfort".
4. Each angle should serve ONE clear pain point — not a list. If it can't be summarized in 15 words, it's too vague.
5. Stay grounded in real footage when listed. If the angle requires a shot that isn't listed, put it in locale_notes.missing_footage instead of pretending it exists.
6. AVOID generic adjectives like "amazing", "premium", "next-level", "revolutionary", "game-changing". Use specific sensory language instead.
7. For home goods / smart-home / accessibility products (e.g. motorized blinds, smart locks): explicitly cover at least ONE of these distinct angle territories — convenience / safety / family-with-kids / aging-parent / pet / smart-home-routine / energy-savings / look-of-the-room. Do NOT repeat the same territory across optimization angles.
8. Every angle's locale_notes.primary_cta must be DIFFERENT (different verb, different offer surface).
9. EXPLORATION angles must clearly take the assigned theme as their backbone — readers should be able to identify which theme an angle belongs to without seeing the theme key.

All free-text fields are English. Output JSON only — no markdown, no commentary.`;

export interface AngleLLMOutput {
  angles: Array<{
    type: "OPTIMIZATION" | "EXPLORATION";
    sort_order: number;
    title: string;
    hook: string;
    narrative: string;
    exploration_theme?: string;
    locale_notes?: Record<string, unknown>;
  }>;
}

export interface GenerateAnglesArgs {
  roundId: string;
  sellingPointId?: string;
}

export async function generateAnglesForRound(args: GenerateAnglesArgs) {
  const round = await db.round.findUnique({
    where: { id: args.roundId },
    include: {
      deliveryOrder: {
        include: { sellingPoints: { orderBy: { rank: "asc" } } },
      },
      baseDistillation: true,
      angles: true,
    },
  });
  if (!round) throw new Error("轮次不存在");
  if (round.angles.length > 0) {
    throw new Error("该轮次已生成 angle，不能重复生成");
  }

  const sp =
    round.deliveryOrder.sellingPoints.find(
      (s) => s.id === (args.sellingPointId ?? round.primarySellingPointId),
    ) ?? round.deliveryOrder.sellingPoints[0];
  if (!sp) throw new Error("交付单尚未提炼卖点");

  // 计算已使用的探索主题，避免重复
  const usedThemes: string[] = (
    await db.contentAngle.findMany({
      where: {
        round: { deliveryOrderId: round.deliveryOrderId },
        type: AngleType.EXPLORATION,
      },
      select: { explorationTheme: true },
    })
  )
    .map((a) => a.explorationTheme)
    .filter((k): k is string => !!k);

  const themes = pickExplorationThemes(usedThemes, round.explorationSlots);

  const llmResult = isLLMAvailable()
    ? await llmAngles({
        round,
        sellingPoint: sp,
        themes,
      })
    : mockAngles(themes);

  await db.$transaction(
    llmResult.map((a, i) =>
      db.contentAngle.create({
        data: {
          roundId: round.id,
          sortOrder: a.sort_order ?? i + 1,
          type: a.type === "EXPLORATION" ? AngleType.EXPLORATION : AngleType.OPTIMIZATION,
          title: a.title,
          hook: a.hook,
          narrative: a.narrative,
          explorationTheme: a.exploration_theme ?? null,
          sourceDistillationId:
            a.type === "OPTIMIZATION" ? round.baseDistillationId : null,
          localeNotes: (a.locale_notes ?? {}) as unknown as Prisma.InputJsonValue,
        },
      }),
    ),
  );

  await db.round.update({
    where: { id: round.id },
    data: { status: "ANGLES_READY" },
  });

  await db.deliveryOrder.update({
    where: { id: round.deliveryOrderId },
    data: { status: "ROUND_ACTIVE" },
  });

  return db.contentAngle.findMany({
    where: { roundId: round.id },
    orderBy: { sortOrder: "asc" },
  });
}

async function llmAngles(ctx: {
  round: {
    roundIndex: number;
    optimizationSlots: number;
    explorationSlots: number;
    deliveryOrder: {
      productCategory: string;
      targetCountry: string;
      targetLanguage: string;
      targetRegionVariant: string | null;
      productInput: Prisma.JsonValue;
    };
    baseDistillation: { summary: string; structured: Prisma.JsonValue } | null;
  };
  sellingPoint: {
    title: string;
    body: string;
    localizations: Prisma.JsonValue;
  };
  themes: ExplorationTheme[];
}): Promise<AngleLLMOutput["angles"]> {
  const { round, sellingPoint, themes } = ctx;
  const order = round.deliveryOrder;

  const user = `轮次 #${round.roundIndex} · 需要 ${round.optimizationSlots} 优化 + ${round.explorationSlots} 探索 = ${round.optimizationSlots + round.explorationSlots} 条

本轮主打卖点:
- title: ${sellingPoint.title}
- body: ${sellingPoint.body}
- localizations: ${JSON.stringify(sellingPoint.localizations)}

上一轮蒸馏特征:
${round.baseDistillation ? JSON.stringify({ summary: round.baseDistillation.summary, structured: round.baseDistillation.structured }, null, 2) : "（本轮为首轮，无蒸馏特征；OPTIMIZATION 请基于卖点/调研自行设计）"}

探索主题（必须按顺序填入）:
${themes.map((t, i) => `  slot ${i + 1}: key=${t.key}, label=${t.label}, prompt=${t.prompt}`).join("\n")}

产品输入:
${JSON.stringify(order.productInput, null, 2)}

目标国家/语言: ${order.targetCountry} / ${order.targetLanguage}${order.targetRegionVariant ? ` (${order.targetRegionVariant})` : ""}

请输出 JSON。所有 EXPLORATION 的 exploration_theme 字段必须严格等于上面的 theme key。`;

  const { data } = await chatJsonByTier<AngleLLMOutput>({
    tier: "creative",
    stage: "angle_generation",
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.85,
    maxTokens: 3500,
  });
  return data.angles ?? [];
}

function mockAngles(themes: ExplorationTheme[]): AngleLLMOutput["angles"] {
  const optimizations = Array.from({ length: 3 }).map((_, i) => ({
    type: "OPTIMIZATION" as const,
    sort_order: i + 1,
    title: `[Mock Opt ${i + 1}] Soft-touch hero close-up`,
    hook: `POV: you just unboxed this and it's softer than expected`,
    narrative: `Quick hook → close-up texture shot → wide cozy scene → CTA.`,
    locale_notes: { on_camera_recommendation: "PRODUCT_ONLY" },
  }));
  const explorations = themes.map((t, i) => ({
    type: "EXPLORATION" as const,
    sort_order: 4 + i,
    title: `[Mock Expl ${i + 1}] ${t.label}`,
    hook: `${t.prompt.slice(0, 60)}…`,
    narrative: t.description,
    exploration_theme: t.key,
    locale_notes: { on_camera_recommendation: "PRODUCT_ONLY" },
  }));
  return [...optimizations, ...explorations];
}

export function listThemePool() {
  return BLANKET_THEME_POOL;
}
