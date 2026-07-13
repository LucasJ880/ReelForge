/**
 * 视觉参考分析（2026-07 真实场景对齐）。
 *
 * 痛点：consistency-bible / prompt-intelligence 之前只拿到参考图的文件名，
 * LLM 会凭空想象场景，而 Seedance 又拿到真实照片 —— 文字锚与图片锚互相打架，
 * 生成结果和客户的真实门店「贴不上」。
 *
 * 方案：plan 阶段用 GPT-4o 视觉模型真正「看一遍」所有参考图，提取：
 *  - 是否真实场所（门店/室内实拍） + 精确的场所描述（招牌文字逐字保留）
 *  - 产品描述（如有产品图）
 * 结果注入 bible 与每段 prompt，让文字锚和 Omni-Reference 图片锚完全一致。
 *
 * 失败兜底：LLM 不可用 / 分析失败返回 null，管线按旧行为继续（不阻塞出片）。
 */

import { analyzeImages, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";
import type { UploadedAsset } from "@/types/video-generation";

export interface VisualReferenceAnalysis {
  /// 参考图是否包含一个真实场所（店铺/门头/室内实景）
  isRealLocation: boolean;
  /// 场所的精确英文描述（布局/家具/材质/色调/门头），供 bible.environmentProfile 逐字使用
  locationDescription: string | null;
  /// 招牌/门头上的可读文字（逐字，如 "Meow Club"）；null = 无
  signageText: string | null;
  /// 场所内可入镜的标志性元素（如 "natural wood cat tree", "flower-petal cushion chairs"）
  keyFeatures: string[];
  /// 产品的精确英文描述（如参考图里有产品）；null = 无产品图
  productDescription: string | null;
  /// 每张照片覆盖的视角（如 "storefront exterior at night", "interior seating area"）
  viewsCovered: string[];
  /// 参与分析的照片张数（决定空间边界收紧程度）
  photoCount: number;
}

const SYSTEM_PROMPT = `You are a location scout and product analyst for an AI video production. You will see reference photos uploaded by a client. Extract a precise visual inventory so that a video generator can faithfully reproduce what is in the photos.

Return strict JSON:
{
  "isRealLocation": true/false — true if the photos show a real place (storefront, shop interior, restaurant, venue...),
  "locationDescription": "if isRealLocation: one dense English paragraph (50-90 words) describing the place exactly as photographed: storefront facade (materials, colors, sign), interior layout, furniture with materials and colors, flooring, lighting fixtures, decor. Be faithful — never invent items not visible. null if not a location",
  "signageText": "the exact readable text on the storefront sign or logo, verbatim (e.g. 'Meow Club'), null if none",
  "keyFeatures": ["3-6 distinctive photographable features of the place or product, each 2-6 words, e.g. 'natural wood cat climbing tree'"],
  "productDescription": "if any photo shows a product for sale: its exact color/material/shape/details in 25-50 words, else null",
  "viewsCovered": ["one short entry PER PHOTO describing the view it covers, in photo order, e.g. 'storefront exterior at night', 'interior: cat cabin wall and seating corner'"]
}

RULES:
- Describe only what is actually visible in the photos.
- Ignore any social-media watermarks or usernames overlaid on the photos — they are not part of the location.
- signageText must be verbatim, keep original language and capitalization.
- viewsCovered must have exactly one entry per photo, in the same order as the photos.`;

export async function analyzeVisualReferences(
  assets: UploadedAsset[],
  briefHint: string,
): Promise<VisualReferenceAnalysis | null> {
  /// GPT-4o 一次最多看 8 张（低清模式）；Seedance Omni-Reference 同样吃得下 8 张
  const images = assets.filter((a) => a.type === "IMAGE").slice(0, 8);
  if (images.length === 0) return null;
  if (isLLMForcedMock() || !isLLMAvailable()) return null;

  try {
    const { data } = await analyzeImages(
      images.map((a) => a.url),
      SYSTEM_PROMPT,
      `The client's request: "${briefHint.slice(0, 400)}"\nAnalyze the ${images.length} reference photo(s) and return the JSON now.`,
    );

    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

    return {
      isRealLocation: data.isRealLocation === true,
      locationDescription: str(data.locationDescription),
      signageText: str(data.signageText),
      keyFeatures: Array.isArray(data.keyFeatures)
        ? data.keyFeatures.map(String).filter((s) => s.trim().length > 0).slice(0, 6)
        : [],
      productDescription: str(data.productDescription),
      viewsCovered: Array.isArray(data.viewsCovered)
        ? data.viewsCovered.map(String).filter((s) => s.trim().length > 0).slice(0, 8)
        : [],
      photoCount: images.length,
    };
  } catch (err) {
    console.warn(
      "[visual-reference-analysis] vision failed; continuing without:",
      (err as Error).message,
    );
    return null;
  }
}
