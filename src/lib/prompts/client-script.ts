import { PROMPT_VERSIONS } from "./index";
import type { ClientBrief } from "@/lib/schemas/client-brief";
import type {
  CreativeEvidenceCardCore,
  CreativeIndustry,
} from "@/lib/schemas/creative-evidence";
import type { ScriptOutput } from "@/lib/schemas/script-output";

/**
 * Prompt: generateClientScript
 *
 * 输入：ClientBrief + 选中的 CreativeEvidenceCard（可选）
 * 输出：ScriptOutput（hook / voiceover / captions / cta / 平台版本 / 合规备注）
 */
export const PROMPT_VERSION = PROMPT_VERSIONS.clientScript;

export const CLIENT_SCRIPT_SYSTEM = `你是 Aivora 的本地商家短视频脚本作者。基于商家 brief + 一张参考创意证据卡（结构灵感），写一条该商家自己的原创脚本。只输出 JSON。

输出 JSON：
{
  "language": "BCP47 语言代码，例如 en-US / en-CA / zh-CN",
  "title": "短视频标题（10 词以内）",
  "hook": "前 3 秒口播 hook（不要复制证据卡中的原文）",
  "voiceover": "整段口播稿，不带任何舞台指示。语速按 ~2.5 词/秒。总时长贴合 brief.videoLengthSec",
  "captions": [
    { "sceneIndex": 1, "text": "屏幕字幕（短句）", "startSec": 0, "endSec": 3 }
  ],
  "cta": "结尾的 CTA",
  "platformVariants": {
    "tiktok": "针对 TikTok 优化的版本（必要时调整开场和 CTA）",
    "instagram_reels": "针对 IG Reels 的版本"
  },
  "complianceNotes": [
    "如果商家行业是 real_estate / 金融 / 医疗 / 食品，必须列出对应 disclaimer"
  ],
  "copiedFromReference": false
}

强制要求：
- 严禁复制证据卡 referenceUrl 视频的原字幕、原口播、原标题。
- 必须使用 brief.businessName 作为商家自我介绍；不要替换成参考卡里的品牌。
- voiceover 总词数严格匹配 brief.videoLengthSec * 2.5（±10%）。
- 行业合规：
  - real_estate: 加入 "Equal Housing Opportunity" 或类似公平住房 disclaimer；避免直接承诺房产升值。
  - restaurant: 不声称未经验证的健康/营养收益。
  - local_service: 不夸大效果；强调真实门店/团队。
  - pet_business: 不声称疗愈/治疗效果。
- copiedFromReference 必须为 false，且如果你判断自己的输出与参考卡有重复用语，必须主动改写。
- 输出必须是合法 JSON。`;

export interface ClientScriptInput {
  brief: ClientBrief;
  selectedCard?: CreativeEvidenceCardCore | null;
  /// 推荐目标语言；若未提供则按 industry 默认 en-US
  targetLanguage?: string;
}

export function buildClientScriptUser(input: ClientScriptInput) {
  const { brief, selectedCard } = input;
  const targetLanguage =
    input.targetLanguage ?? defaultLanguageForIndustry(brief.industry);
  const targetWordCount = Math.round(brief.videoLengthSec * 2.5);

  return `商家 Brief:
${JSON.stringify(brief, null, 2)}

目标语言: ${targetLanguage}
目标时长: ${brief.videoLengthSec}s （口播约 ${targetWordCount} 词，允许 ±10%）

参考创意证据卡（仅作结构灵感，禁止复制原文）:
${
  selectedCard
    ? JSON.stringify(
        {
          slug: selectedCard.slug,
          title: selectedCard.title,
          hookPattern: selectedCard.hookPattern,
          structureBreakdown: selectedCard.structureBreakdown,
          visualStyle: selectedCard.visualStyle,
          whyItWorks: selectedCard.whyItWorks,
          riskNotes: selectedCard.riskNotes,
        },
        null,
        2,
      )
    : "(商家未选择参考卡，请基于 brief 自行设计 hook 与结构)"
}

请输出 JSON。captions 数量不超过 8。如果 brief.industry 触发合规要求，必须在 complianceNotes 中列出。`;
}

export function defaultLanguageForIndustry(industry: CreativeIndustry) {
  switch (industry) {
    case "real_estate":
    case "local_service":
    case "pet_business":
    case "restaurant":
      return "en-US";
    default:
      return "en-US";
  }
}

/** Mock 输出，用于无 OPENAI_API_KEY 或测试 */
export function mockClientScript(input: ClientScriptInput): ScriptOutput {
  const { brief } = input;
  const targetLanguage =
    input.targetLanguage ?? defaultLanguageForIndustry(brief.industry);
  const cta =
    brief.brandAssets?.ctaText ??
    fallbackCtaForObjective(brief.objective, brief.businessName);

  const captions = [
    { sceneIndex: 1, text: `${brief.businessName} · 真实素材开场`, startSec: 0, endSec: 3 },
    { sceneIndex: 2, text: "真实细节 · 真实信任", startSec: 3, endSec: Math.max(6, brief.videoLengthSec - 4) },
    { sceneIndex: 3, text: cta, startSec: Math.max(7, brief.videoLengthSec - 4), endSec: brief.videoLengthSec },
  ];

  return {
    language: targetLanguage,
    title: `[Mock] ${brief.businessName} · ${brief.objective}`,
    hook: `[Mock Hook] If you're near ${brief.businessName}, this is the place locals keep coming back to.`,
    voiceover: buildMockVoiceover(brief.businessName, brief.videoLengthSec),
    captions,
    cta,
    platformVariants: {
      [brief.targetPlatforms[0] ?? "tiktok"]:
        "[Mock] Same beats, slightly punchier opening for the platform.",
    },
    complianceNotes: complianceNotesFor(brief.industry),
    copiedFromReference: false,
  };
}

function buildMockVoiceover(businessName: string, durationSec: number) {
  const words = Math.round(durationSec * 2.5);
  const filler = new Array(Math.max(0, words - 12)).fill("real").join(" ");
  return `[Mock] At ${businessName}, this is what a typical day looks like. ${filler}. Save this clip and stop by when you're nearby.`.trim();
}

function fallbackCtaForObjective(
  objective: ClientBrief["objective"],
  businessName: string,
) {
  switch (objective) {
    case "get_leads":
      return `Tap the link to message ${businessName} today.`;
    case "promote_listing":
      return `Save this listing and DM ${businessName} for a tour.`;
    case "increase_bookings":
      return `Book your spot at ${businessName} this week.`;
    case "announce_offer":
      return `Catch this offer at ${businessName} before it ends.`;
    case "brand_awareness":
      return `Follow ${businessName} for more local moments like this.`;
    default:
      return `Visit ${businessName} this week.`;
  }
}

function complianceNotesFor(industry: ClientBrief["industry"]) {
  switch (industry) {
    case "real_estate":
      return [
        "All listings shown are subject to availability and verification.",
        "Equal Housing Opportunity disclaimer must appear in caption or end card.",
      ];
    case "restaurant":
      return [
        "Do not claim health benefits without verified nutrition data.",
      ];
    case "pet_business":
      return [
        "Do not claim therapeutic / medical effects for pet products.",
      ];
    case "local_service":
      return ["Pricing and availability shown are for example only."];
    default:
      return [];
  }
}
