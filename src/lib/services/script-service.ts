import { Prisma, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";

const SYSTEM_PROMPT = `你是一名真实素材短视频广告脚本专家。基于 angle + 卖点 + 产品/服务 + 客户上传素材 + 目标语言，输出一条 15-30 秒的短视频脚本。只输出 JSON。

输出 JSON:
{
  "language": "BCP47 语言代码，如 en-US / fr-CA / de-DE",
  "full_text": "逐字口播稿，不含任何舞台指示（不要写 '旁白：'、'镜头：' 等），只有要被说出来的字。自然语速每秒约 2.5 词。",
  "hook": "脚本开头 1-3 秒那句必定抓人的句子（从 full_text 中抽出）",
  "cta": "结尾的 CTA 句（从 full_text 中抽出；若不出现 CTA 则为空字符串）"
}

要求：
- 严格使用目标语言，语气与 angle 的 locale_notes / on-camera 模式匹配。
- 不编造产品事实。
- 脚本必须能用客户已有真实素材剪出来；如果 angle.locale_notes.footage_pick 或 productInput.footage_notes 提到可用镜头，脚本要围绕这些镜头展开。
- 口吻偏真实 UGC/广告本地化，不要像传统电视广告。`;

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

  const { data } = await chatJson<ScriptLLM>({
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
