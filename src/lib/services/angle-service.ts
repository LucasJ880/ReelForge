import { Prisma, AngleType } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";
import {
  BLANKET_THEME_POOL,
  pickExplorationThemes,
  type ExplorationTheme,
} from "@/lib/config/blanket-themes";

const SYSTEM_PROMPT = `你是一名 TikTok 短视频内容策划专家。你的任务：为一个 "selling point"（卖点）产出赛马用的 5 条 angle（3 条优化型 + 2 条探索型）。只输出 JSON。

输入你会收到：
- 卖点（title + body + localizations）
- 产品输入
- 目标国家/语言
- 3 条 "optimization slots" 需要基于上一轮蒸馏特征做改进（首轮无蒸馏，可凭调研/卖点自行发挥，但必须突出"优化"思路）
- 2 条 "exploration slots"，每条有一个预先指定的 theme（主题池 key），你必须围绕该 theme 产出 angle

输出 JSON：
{
  "angles": [
    {
      "type": "OPTIMIZATION" | "EXPLORATION",
      "sort_order": 1,
      "title": "25 词以内英文 angle 标题",
      "hook": "开头 1-3 秒的视觉/文案 hook（英文）",
      "narrative": "30-50 词 angle 叙事概要（英文）",
      "exploration_theme": "仅 EXPLORATION 必填，对应输入的 theme key",
      "locale_notes": {
        "target_language": "${/* 由调用方注入 */ ""}",
        "on_camera_recommendation": "该 angle 最推荐的出镜方式: NONE / PRODUCT_ONLY / SELF_RAW / SELF_VOICE_REPLACED / SELF_SUBTITLED / UGC_AVATAR",
        "cultural_notes": "文化适配建议，英文 1-2 句"
      }
    }
  ]
}

要求：
- angle 1-3 为 OPTIMIZATION（sort_order 1/2/3），angle 4-5 为 EXPLORATION（sort_order 4/5）。
- OPTIMIZATION 之间必须有明显差异（不同 hook 结构、不同场景、不同节奏），避免同质化。
- EXPLORATION 必须严格围绕 theme_prompt 展开。
- 所有文字字段使用英文。`;

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

  const { data } = await chatJson<AngleLLMOutput>({
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
