import { Prisma, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJsonByTier, isLLMAvailable } from "@/lib/ai";

const SYSTEM_PROMPT = `You are a senior short-form ad scriptwriter for vertical video (TikTok / Reels / Shorts).
Your job: write the spoken script for ONE 15–30 second ad based on the supplied angle, selling point, product input, real footage list, and target language.

OUTPUT JSON ONLY:
{
  "language": "BCP47 code, e.g. en-US / fr-CA / de-DE",
  "full_text": "Verbatim voiceover. No stage directions, no '[Narrator]:', no scene labels — only words to be spoken. Natural pace ~2.5 words/sec.",
  "hook": "The first 1–3 second line that stops the scroll (must be a sub-string of full_text)",
  "cta": "The closing call-to-action line (sub-string of full_text). Empty string if the angle deliberately has no CTA."
}

WRITING REQUIREMENTS — failing any of these is a failure:
1. Match the angle's hook exactly in spirit. The first line of full_text must be the hook line.
2. STAY ON the angle's pain point. Do NOT widen into "comfort for everyone" / "perfect for any home" / etc. Generic widening is the #1 failure.
3. Be visually tied to actual real footage. If angle.locale_notes.footage_pick mentions specific shots, the script must reference those moments naturally.
4. Concrete > abstract. Use sensory specifics: "press one button", "blinds glide down", "toddler walks in", "morning sun hits the wall". Avoid: "amazing", "premium", "next-level", "revolutionary", "transform your life".
5. Keep the script tight — leave breathing room. 15s ≈ 35–40 words; 30s ≈ 70–80 words.
6. CTA verb must match the angle's locale_notes.primary_cta. Don't override.
7. If on_camera_mode is PRODUCT_ONLY, write a voiceover-friendly script (no first-person stories about the speaker themselves). If SELF_RAW / SELF_SUBTITLED, write in first person.
8. Use the target language and locale variant. For en-US, sound like a small US business owner — friendly, concrete, not over-polished.
9. Do NOT fabricate product facts (price, GSM, battery life, certifications) that aren't in productInput. If you need a fact you don't have, say "see product page" or stay in the sensory/lifestyle frame.
10. For home / smart-home / accessibility products (e.g. motorized blinds): emphasize the small everyday moment, not the technology spec sheet.

Output JSON only — no markdown.`;

interface ScriptLLM {
  language: string;
  full_text: string;
  hook: string;
  cta: string;
}

export async function generateScriptForBrief(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      contentAngle: {
        include: {
          round: {
            include: {
              deliveryOrder: {
                include: { sellingPoints: { orderBy: { rank: "asc" } } },
              },
            },
          },
        },
      },
    },
  });
  if (!brief) throw new Error("Brief 不存在");
  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.SCRIPT_DRAFTING },
  });

  const angle = brief.contentAngle;
  const order = angle.round.deliveryOrder;
  const sp = order.sellingPoints[0];

  const result = isLLMAvailable()
    ? await llmScript({
        angle,
        brief,
        order,
        sellingPointTitle: sp?.title,
        sellingPointBody: sp?.body,
      })
    : mockScript(order.targetLanguage, brief.durationSec);

  await db.script.updateMany({
    where: { videoBriefId: briefId },
    data: { isCurrent: false },
  });
  const latest = await db.script.findFirst({
    where: { videoBriefId: briefId },
    orderBy: { version: "desc" },
  });
  const script = await db.script.create({
    data: {
      videoBriefId: briefId,
      version: (latest?.version ?? 0) + 1,
      language: result.language,
      fullText: result.full_text,
      hook: result.hook,
      cta: result.cta,
      isCurrent: true,
    },
  });

  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.SCRIPT_READY },
  });
  return script;
}

async function llmScript(ctx: {
  angle: {
    title: string;
    hook: string | null;
    narrative: string | null;
    localeNotes: Prisma.JsonValue;
  };
  brief: { durationSec: number; onCameraMode: string };
  order: {
    productCategory: string;
    targetCountry: string;
    targetLanguage: string;
    targetRegionVariant: string | null;
    productInput: Prisma.JsonValue;
  };
  sellingPointTitle?: string;
  sellingPointBody?: string;
}): Promise<ScriptLLM> {
  const user = `Angle:
- title: ${ctx.angle.title}
- hook: ${ctx.angle.hook}
- narrative: ${ctx.angle.narrative}
- locale_notes: ${JSON.stringify(ctx.angle.localeNotes)}

Brief:
- duration_sec: ${ctx.brief.durationSec}
- on_camera_mode: ${ctx.brief.onCameraMode}

卖点:
- ${ctx.sellingPointTitle}: ${ctx.sellingPointBody}

目标国家/语言: ${ctx.order.targetCountry} / ${ctx.order.targetLanguage}${ctx.order.targetRegionVariant ? ` (${ctx.order.targetRegionVariant})` : ""}

产品输入:
${JSON.stringify(ctx.order.productInput, null, 2)}

请输出 JSON 脚本。language 字段要精确到 BCP47，例如 en-US / fr-CA / de-DE。`;

  const { data } = await chatJsonByTier<ScriptLLM>({
    tier: "creative",
    stage: "client_script",
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.8,
    maxTokens: 1500,
  });
  return data;
}

function mockScript(targetLanguage: string, durationSec: number): ScriptLLM {
  const wordCount = Math.max(20, Math.round(durationSec * 2.3));
  const body = new Array(wordCount).fill("proof").join(" ");
  return {
    language: `${targetLanguage}-XX`,
    full_text: `POV: you finally found the real-life fix your customers keep asking for. ${body}. Watch the real footage and try it today.`,
    hook: "POV: you finally found the real-life fix your customers keep asking for.",
    cta: "Watch the real footage and try it today.",
  };
}
