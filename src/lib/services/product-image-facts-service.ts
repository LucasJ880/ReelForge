import { getAiProvider } from "@/lib/ai";

/**
 * O1 · 从一张产品图起片（PRD §3，P0 主入口之一）。
 *
 * 为什么单独一层：`product_image` 曾经是个**空壳** —— 接口收下这个来源，
 * 但服务层没有任何图像理解，只是把 URL 字符串当一句话用，
 * 于是商家上传产品图会拿到一份和图无关的计划，界面上还看不出来。
 * 那比不做更糟：不做至少是诚实的。
 *
 * 这里的产出与商品链接抓取同路——都是**事实行**，喂给内容计划。
 */

const SYSTEM_PROMPT = `You describe a product photo for a small business owner's content planner.

Return JSON only:
{
  "productName": "what the object is, plain words",
  "category": "product category",
  "visibleFacts": ["only what is VISIBLE in the photo"],
  "sceneContext": "where the photo appears to be taken, or null",
  "hasVisibleBranding": true | false
}

HARD RULES:
1. Describe ONLY what is visible. Never guess price, material grade, origin,
   certifications, or claims that cannot be seen.
2. If you cannot tell what the product is, set productName to null.
3. visibleFacts must be short factual phrases, not marketing copy.
4. Output JSON only.`;

export type ProductImageFacts = {
  productName: string | null;
  category: string | null;
  visibleFacts: string[];
  sceneContext: string | null;
  hasVisibleBranding: boolean;
};

export class ProductImageFactsError extends Error {
  constructor(
    message: string,
    readonly reason: "unavailable" | "unreadable",
  ) {
    super(message);
    this.name = "ProductImageFactsError";
  }
}

export async function readProductImageFacts(
  imageUrl: string,
): Promise<ProductImageFacts> {
  const ai = getAiProvider();
  if (!ai.isConfigured() || ai.isForceMock()) {
    /// 明确失败而不是静默退回「把 URL 当一句话」——
    /// 商家给了图却拿到无关计划，比报错更糟。
    throw new ProductImageFactsError(
      "现在读不了产品图，先用一句话描述你的生意",
      "unavailable",
    );
  }

  const { data } = await ai.analyzeImages({
    imageUrls: [imageUrl],
    system: SYSTEM_PROMPT,
    user: "Describe this product photo for content planning.",
  });

  const facts = coerceFacts(data);
  if (!facts) {
    throw new ProductImageFactsError(
      "这张图看不出是什么产品，换一张或直接用一句话描述",
      "unreadable",
    );
  }
  return facts;
}

export function coerceFacts(raw: unknown): ProductImageFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const productName = str(value.productName);
  const visibleFacts = Array.isArray(value.visibleFacts)
    ? value.visibleFacts
        .map((item) => str(item))
        .filter((item): item is string => Boolean(item))
        .slice(0, 12)
    : [];

  /// 认不出产品、又说不出任何可见事实 —— 这张图对排期没有价值，
  /// 与其拿它编一份计划，不如让商家换一张。
  if (!productName && visibleFacts.length === 0) return null;

  return {
    productName,
    category: str(value.category),
    visibleFacts,
    sceneContext: str(value.sceneContext),
    hasVisibleBranding: value.hasVisibleBranding === true,
  };
}

/**
 * 转成喂给内容计划的事实行。
 * 与 `factsToPromptLines`（商品链接）保持同一形状，下游不必分辨来源。
 */
export function imageFactsToPromptLines(facts: ProductImageFacts): string[] {
  const lines: string[] = [];
  if (facts.productName) lines.push(`产品名：${facts.productName}`);
  if (facts.category) lines.push(`品类：${facts.category}`);
  if (facts.visibleFacts.length) {
    lines.push(`图上可见：${facts.visibleFacts.join("；")}`);
  }
  if (facts.sceneContext) lines.push(`拍摄场景：${facts.sceneContext}`);
  /// 有可见品牌标识时提醒生成侧别把它盖掉 —— 这与 B1 产品锚定是同一条线。
  if (facts.hasVisibleBranding) {
    lines.push("图上有可见的品牌标识，配图不要遮挡或改写它");
  }
  return lines;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}
