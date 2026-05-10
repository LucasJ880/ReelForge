import { PROMPT_VERSIONS } from "./index";
import type {
  CreativeEvidenceBreakdownLLM,
  CreativeIndustry,
  CreativeObjective,
  CreativePlatform,
} from "@/lib/schemas/creative-evidence";

/**
 * Prompt: generateCreativeEvidenceBreakdown
 *
 * 用途：把运营录入的「raw reference notes + 公开 metrics + industry/platform/objective」
 * 转成结构化 CreativeEvidenceCard 字段（hookPattern / structureBreakdown / whyItWorks /
 * suggestedUseCase / riskNotes / clientPreviewSummary / recommendationScore）。
 *
 * 合规约束（写在 system 中，强制模型遵守）：
 * - 不复制原视频字幕/原配音/原镜头脚本；
 * - 不承诺指标实时；
 * - 地产 / 金融 / 医疗 / 食品行业必须给出 disclaimer 提示。
 */
export const PROMPT_VERSION = PROMPT_VERSIONS.creativeEvidenceBreakdown;

export const CREATIVE_EVIDENCE_BREAKDOWN_SYSTEM = `你是 Aivora 的创意证据卡分析师。给你一段关于参考视频的「运营笔记 + 公开指标 + 行业/平台/目标」，请输出结构化的"为什么有效"分析。只输出 JSON。

输出 JSON：
{
  "hookPattern": {
    "pattern": "用 1-2 句概括这条视频前 3 秒的钩子模式（不要复制原文）",
    "openingSeconds": 3,
    "hookType": "POV | Curiosity | Stat | Reveal | Pain | Demo | Question | Authority",
    "whyItStops": "为什么这个 hook 能让目标观众停下来（针对该行业 + 目标）"
  },
  "structureBreakdown": {
    "segments": [
      { "from": 0, "to": 3, "role": "hook", "narrative": "用你自己的话描述这一段在做什么；不要逐字抄原视频" }
    ],
    "pacingNotes": "整体节奏的短评"
  },
  "whyItWorks": "整段为什么对这个行业/目标有效（中文，60-160 字，不要复制原 caption）",
  "visualStyle": "视觉风格关键词（中文，30-80 字）",
  "suggestedUseCase": "建议本地商家在什么场景下复用这套结构（中文，30-80 字）",
  "riskNotes": "合规/风险提醒（地产、金融、医疗、食品行业必须给出 disclaimer 提醒；其它行业可空字符串）",
  "clientPreviewSummary": "给商家看的 2-3 句话摘要：这个卡为什么适合 TA。中文，要让小白能看懂",
  "recommendationScore": 0-100 整数，按行业匹配 + 目标匹配 + hook 强度综合给分
}

强制要求：
- 严禁复制原视频的字幕、口播、镜头脚本；只能做结构性解读。
- 不要承诺指标实时；如果引用了 publicMetrics，请在 narrative 中明确 "as of <observedAt>"。
- 不要把第三方账号、品牌、艺人信息写成 Aivora 的承诺；
- 地产相关一律提醒"NMLS/相关合规"；金融相关提醒"非投资建议"；医疗提醒"非医疗建议"；食品提醒"过敏/营养声明合规"。
- 输出必须是合法 JSON。
- recommendationScore 不要给 0 或 100；正常范围 35-92。`;

export interface CreativeEvidenceBreakdownInput {
  rawReferenceNotes: string;
  industry: CreativeIndustry;
  platform: CreativePlatform;
  objective: CreativeObjective;
  publicMetricsSummary?: string;
  sourcePlatform?: string;
  referenceUrl?: string;
}

export function buildCreativeEvidenceBreakdownUser(
  input: CreativeEvidenceBreakdownInput,
) {
  return `行业: ${input.industry}
平台: ${input.platform}
目标: ${input.objective}
来源平台: ${input.sourcePlatform ?? "(未填)"}
原平台链接: ${input.referenceUrl ?? "(未填)"}

公开指标摘要:
${input.publicMetricsSummary ?? "(未提供)"}

运营笔记 (raw reference notes):
"""
${input.rawReferenceNotes}
"""

请按 system 要求输出 JSON。recommendationScore 必须基于运营笔记中的"行业适配度 + hook 强度 + 可复制性"综合判断。`;
}

/** Mock 输出（用于无 OPENAI_API_KEY 或测试时占位） */
export function mockCreativeEvidenceBreakdown(
  input: CreativeEvidenceBreakdownInput,
): CreativeEvidenceBreakdownLLM {
  return {
    hookPattern: {
      pattern: "[Mock] POV + 真实场景开场，3 秒内点出本地相关性",
      openingSeconds: 3,
      hookType: "POV",
      whyItStops:
        "[Mock] 视频在前 3 秒就放出 viewer 能直接代入的真实人/真实场景，配合大字幕，目标观众容易判断「这是讲我」。",
    },
    structureBreakdown: {
      segments: [
        {
          from: 0,
          to: 3,
          role: "hook",
          narrative:
            "[Mock] 真实场景大字幕开场，使用第一人称视角",
        },
        {
          from: 3,
          to: 18,
          role: "proof",
          narrative: "[Mock] 用 2-3 个真实细节做 proof，节奏紧凑",
        },
        {
          from: 18,
          to: 30,
          role: "cta",
          narrative: "[Mock] 给本地化的低门槛 CTA，留 1.5s 静帧",
        },
      ],
      pacingNotes: "[Mock] 前快后慢，留出 CTA 呼吸感",
    },
    whyItWorks: `[Mock] 这条参考视频针对 ${input.industry} 行业的 ${input.objective} 目标足够聚焦，hook 用真人真场景建立可信度，proof 段没有过度承诺。`,
    visualStyle:
      "[Mock] 真实手机质感、自然光、9:16、字幕加粗居中、轻微 hand-held",
    suggestedUseCase:
      "[Mock] 本地商家可以用相同结构（POV hook + 2-3 个真实 proof + 本地 CTA）替换成自己的真实素材。",
    riskNotes:
      input.industry === "real_estate"
        ? "[Mock] 地产相关：避免承诺投资回报；如涉及贷款须显示 NMLS 合规备注"
        : "[Mock] 不要复制原视频字幕/配音；客户上传素材必须有授权",
    clientPreviewSummary: `[Mock] 这是一条用真实场景拍出的 ${input.industry} 短视频，节奏紧凑、CTA 清晰，适合预算有限但有真实素材的本地商家直接借鉴结构。`,
    recommendationScore: 78,
  };
}
