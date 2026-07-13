import { Prisma, ResearchStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJsonByTier, isLLMAvailable } from "@/lib/ai";
import {
  fetchTikTokSignals,
  isApifyAvailable,
  type TikTokCommentSample,
  type TikTokVideoSample,
} from "@/lib/providers/apify-tiktok";

const SYSTEM_PROMPT = `你是一名面向中小商家的真实素材广告策略研究员。你只输出 JSON，不输出 Markdown 或解释性文字。

给定一个产品/服务（类目、目标国家/语言、目标平台、产品事实、客户上传的真实素材清单）以及若干条来自 TikTok 的真实信号（高赞视频 caption / 评论），
请产出一份用于短视频广告制作的结构化市场调研。优先基于真实信号和客户事实；没有证据时明确标注 inferred，不能编造不可验证的产品事实。

输出 JSON 字段：
{
  "trend": "该品类在目标市场近 30-90 天的热度、季节性、舆论关键情绪（英文，60-120 词）",
  "keywords": ["5-10 个高价值搜索/hashtag 关键词，英文，来自真实 caption/hashtags"],
  "competitors": [
    { "name": "出现在真实数据中的竞品/账号", "why_hot": "它在 TikTok 上有效的机制", "hook_used": "它的 hook 类型" }
  ],
  "hot_hooks": ["5-8 条从真实高赞视频 caption 提炼的 hook 句式（英文）"],
  "pain_points": ["5-10 条**抽象总结**的用户痛点/疑虑/未满足需求（英文短句 3-10 词），每条都是对多条评论的归纳——绝不允许直接复制评论原文、表情、反应性感叹（如 'I CAN FEEL IT'、'omg so cute'）。好的示例：'Pills and sheds after one wash'、'Too thin for winter nights'、'Hard to fit a queen sofa'。坏的示例（禁止）：'I hope it was worth it 😭😭😭'、'This is so cute'"],
  "audience_notes": "目标人群画像、偏好的视频格式（英文，80-150 词）",
  "timing": "最佳发布时段建议 + 节日营销窗口（英文，40-80 词）",
  "footage_strategy": {
    "usable_shot_types": ["基于客户素材清单，最值得用于广告的镜头类型，如 product close-up / pet reaction / before-after"],
    "missing_shots": ["为了提升转化，建议补拍的镜头"],
    "first_round_directions": ["首轮最适合测试的 3-5 个广告方向"]
  }
}

要求：
- 所有字段都用英文，针对目标国家/语言本地化
- 不要编造销量数字；没有证据时宁缺勿滥
- pain_points 是重点：请从评论中**抽象归纳**出"抱怨（产品缺陷）、疑虑（购买前担心）、未满足的效果、场景触发"四类信号，不要复制评论原文
- hot_hooks 同理：归纳 caption 的 hook **结构/句式**（如 "Before/After + soft claim"），不要整句抄 caption
- footage_strategy 必须服务于真实素材剪辑，不要建议完全 AI 假生成画面`;

export interface ResearchStructured {
  trend: string;
  keywords: string[];
  competitors: { name: string; why_hot: string; hook_used: string }[];
  hot_hooks: string[];
  pain_points: string[];
  audience_notes: string;
  timing: string;
  footage_strategy?: {
    usable_shot_types: string[];
    missing_shots: string[];
    first_round_directions: string[];
  };
}

export interface ResearchDebug {
  modelUsed?: string;
  tokenUsage?: unknown;
  source: "apify+llm" | "llm-only" | "mock";
  tiktokVideoCount?: number;
  tiktokCommentCount?: number;
}

export async function startMarketResearch(deliveryOrderId: string) {
  const order = await db.deliveryOrder.findUnique({
    where: { id: deliveryOrderId },
  });
  if (!order) throw new Error("交付单不存在");

  const existing = await db.marketResearch.findUnique({
    where: { deliveryOrderId },
  });

  const record = existing
    ? await db.marketResearch.update({
        where: { deliveryOrderId },
        data: { status: ResearchStatus.RUNNING, errorMessage: null },
      })
    : await db.marketResearch.create({
        data: {
          deliveryOrderId,
          status: ResearchStatus.RUNNING,
        },
      });

  await db.deliveryOrder.update({
    where: { id: deliveryOrderId },
    data: { status: "RESEARCHING" },
  });

  try {
    if (!isLLMAvailable()) {
      const mocked = mockResearch(order.productCategory);
      await db.marketResearch.update({
        where: { id: record.id },
        data: {
          status: ResearchStatus.READY,
          structured: mocked as unknown as Prisma.InputJsonValue,
          summary: "[Mock] LLM 未配置，返回占位调研数据",
          debug: { source: "mock" } as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }

    const keywords = buildSearchKeywords(order.productCategory, order.productInput);
    let signals: { videos: TikTokVideoSample[]; comments: TikTokCommentSample[] } = {
      videos: [],
      comments: [],
    };
    if (isApifyAvailable()) {
      try {
        const r = await fetchTikTokSignals(keywords, {
          maxVideosPerKeyword: 10,
          maxCommentsPerVideo: 20,
          country: order.targetCountry,
          language: order.targetLanguage,
        });
        signals = { videos: r.videos, comments: r.comments };
      } catch (err) {
        console.warn("[discovery] Apify signals failed, fallback to LLM-only:", (err as Error).message);
      }
    }

    const userMessage = buildUserMessage(order.productInput, {
      productCategory: order.productCategory,
      targetCountry: order.targetCountry,
      targetLanguage: order.targetLanguage,
      targetRegionVariant: order.targetRegionVariant,
      targetPlatform: order.targetPlatform,
      videos: signals.videos,
      comments: signals.comments,
    });

    const { data, modelUsed, tokenUsage } = await chatJsonByTier<ResearchStructured>({
      tier: "research",
      stage: "market_research",
      system: SYSTEM_PROMPT,
      user: userMessage,
      temperature: 0.5,
      maxTokens: 3000,
    });

    // 安全 fallback：pain_points 字段必须存在
    data.pain_points = Array.isArray(data.pain_points) ? data.pain_points : [];

    const summary = [
      `[Trend] ${data.trend}`,
      `[Audience] ${data.audience_notes}`,
      `[Timing] ${data.timing}`,
      data.pain_points.length > 0
        ? `[Pain Points] ${data.pain_points.slice(0, 3).join(" / ")}`
        : null,
      data.footage_strategy?.first_round_directions?.length
        ? `[Footage Strategy] ${data.footage_strategy.first_round_directions.slice(0, 3).join(" / ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const debug: ResearchDebug = {
      modelUsed,
      tokenUsage,
      source: signals.videos.length > 0 ? "apify+llm" : "llm-only",
      tiktokVideoCount: signals.videos.length,
      tiktokCommentCount: signals.comments.length,
    };

    await db.marketResearch.update({
      where: { id: record.id },
      data: {
        status: ResearchStatus.READY,
        structured: data as unknown as Prisma.InputJsonValue,
        summary,
        debug: debug as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    await db.marketResearch.update({
      where: { id: record.id },
      data: {
        status: ResearchStatus.FAILED,
        errorMessage: (err as Error).message,
      },
    });
    await db.deliveryOrder.update({
      where: { id: deliveryOrderId },
      data: { errorMessage: (err as Error).message },
    });
    throw err;
  }
}

function buildSearchKeywords(
  productCategory: string,
  productInput: Prisma.JsonValue,
): string[] {
  const inp = (productInput ?? {}) as Record<string, unknown>;
  const out = new Set<string>();
  out.add(productCategory);
  if (typeof inp.product_name === "string") out.add(inp.product_name);
  if (typeof inp.target_audience === "string") out.add(inp.target_audience);
  const explicit = Array.isArray(inp.search_keywords) ? (inp.search_keywords as unknown[]) : [];
  for (const k of explicit) {
    if (typeof k === "string" && k.trim().length > 0) out.add(k.trim());
  }
  if (productCategory === "pet_products") {
    ["pet products", "dog tiktok", "pet parents", "tiktokmademebuyit"].forEach((k) =>
      out.add(k),
    );
  }
  if (productCategory === "home_goods") {
    ["home finds", "amazon home", "home decor", "cleaning hacks"].forEach((k) => out.add(k));
  }
  if (productCategory === "local_service") {
    ["local business", "before and after", "service business", "small business tiktok"].forEach(
      (k) => out.add(k),
    );
  }
  return Array.from(out).slice(0, 4);
}

function buildUserMessage(
  productInput: Prisma.JsonValue,
  ctx: {
    productCategory: string;
    targetCountry: string;
    targetLanguage: string;
    targetRegionVariant: string | null;
    targetPlatform: string;
    videos: TikTokVideoSample[];
    comments: TikTokCommentSample[];
  },
) {
  const videoLines = ctx.videos
    .slice()
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 20)
    .map(
      (v, i) =>
        `${i + 1}. likes=${v.likeCount}, plays=${v.playCount}, hook="${v.caption.replace(/\s+/g, " ").slice(0, 180)}"${v.hashtags.length ? ` tags=${v.hashtags.slice(0, 5).join(",")}` : ""}`,
    )
    .join("\n");

  const commentLines = ctx.comments
    .slice()
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 60)
    .map((c, i) => `${i + 1}. (+${c.likeCount}) ${c.text.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");

  const signalBlock =
    ctx.videos.length > 0 || ctx.comments.length > 0
      ? `真实 TikTok 信号（来自 Apify 抓取，按点赞降序）：

===== TOP VIDEOS (${ctx.videos.length}) =====
${videoLines || "(空)"}

===== TOP COMMENTS (${ctx.comments.length}) =====
${commentLines || "(空)"}
`
      : `⚠️ 本次未能拉取到真实 TikTok 数据，请基于常识作答，并在 pain_points 中标注 "(inferred)"。`;

  return `产品类目: ${ctx.productCategory}
目标平台: ${ctx.targetPlatform}
目标国家: ${ctx.targetCountry}
目标语言: ${ctx.targetLanguage}${ctx.targetRegionVariant ? ` (${ctx.targetRegionVariant})` : ""}

产品输入（运营填写）:
${JSON.stringify(productInput, null, 2)}

客户上传的真实素材会出现在 productInput.footage_assets；素材说明会出现在 productInput.footage_notes。请把这些信息用于 footage_strategy。

${signalBlock}

请输出 JSON 调研报告。`;
}

function mockResearch(category: string): ResearchStructured {
  return {
    trend: `[Mock] ${category} 类目在目标市场呈稳定增长，以触感展示和场景代入为主导。`,
    keywords: [
      `${category}`,
      "cozy",
      "winter aesthetic",
      "tiktokmademebuyit",
      "amazonfinds",
      "smallbusiness",
      "ugcads",
    ],
    competitors: [
      {
        name: "Sample Brand A",
        why_hot: "Uses real proof shots and fast UGC pacing",
        hook_used: "POV: you finally found the real-life fix",
      },
    ],
    hot_hooks: [
      "POV: you unbox this",
      "Wait until you see the inside",
      "This is the softest thing ever",
      "Everyone is asking where I got this",
    ],
    pain_points: [
      "[Mock] Worried it will pill after wash",
      "[Mock] Thickness unclear from photos",
      "[Mock] Cat hair / pet hair concerns",
    ],
    audience_notes: `[Mock] Women 18-34, home aesthetic lovers, gift-shoppers, pet owners.`,
    timing: "[Mock] Evenings 8-11pm local time; Q4 peaks; Valentines/Christmas windows.",
    footage_strategy: {
      usable_shot_types: [
        "[Mock] product close-up",
        "[Mock] real usage moment",
        "[Mock] pet or customer reaction",
      ],
      missing_shots: ["[Mock] 3-second hook shot", "[Mock] before/after proof"],
      first_round_directions: [
        "[Mock] pain-point hook",
        "[Mock] UGC review",
        "[Mock] emotional real-life scene",
      ],
    },
  };
}
