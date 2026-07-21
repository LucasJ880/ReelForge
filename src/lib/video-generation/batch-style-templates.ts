/**
 * 批量生成模板种子与纯填空渲染器。
 *
 * INV-B1：批量视频 prompt 只能由这里的 promptSkeleton 做确定性填空。
 * 生成关键路径不 import OpenAI，也不接受客户端传入任意 prompt。
 *
 * 2026-07 产品决策：通用电商风格库下线；当前仅保留 SunnyShutter 客户模版族。
 * 其它客户模版以后再单独接入。
 */

import { SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS } from "@/lib/video-generation/sunnyshutter-commerce-template";

export interface BatchStyleLockedParams {
  duration: 5 | 10 | 15;
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: "720p" | "1080p";
  cameraStyle: string;
  stability: "high" | "balanced";
  humanInteraction: "none" | "controlled";
}

export interface BatchStyleImagesPerVideo {
  min: number;
  max: number;
}

export interface BatchStyleTemplateSeed {
  slug: string;
  version: number;
  name: string;
  nameZh: string;
  category: string;
  coverImage: string;
  promptSkeleton: string;
  negativePrompt: string;
  lockedParams: BatchStyleLockedParams;
  imagesPerVideo: BatchStyleImagesPerVideo;
}

/** Active batch template library — SunnyShutter only. */
export const BATCH_STYLE_TEMPLATE_SEEDS: BatchStyleTemplateSeed[] = [
  ...SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS,
];

export function renderBatchTemplatePrompt(args: {
  promptSkeleton: string;
  imageUrls: string[];
  productName?: string | null;
}): string {
  if (!args.promptSkeleton.includes("{IMAGE_REFS}")) {
    throw new Error("模板缺少必需占位符 {IMAGE_REFS}");
  }
  if (args.imageUrls.length === 0) {
    throw new Error("至少需要 1 张产品参考图");
  }
  /// Shuyu/Seedance 的参考图走 API input_images 字段；提示词里只放位置标签。
  /// 完整 URL 既是 token 噪音，又会把 4.6-4.8k 的 SunnyShutter 骨架顶破
  /// 合作方 5000 字符硬上限（0721 真机复现）。
  const refs = args.imageUrls
    .map((_, index) => `input_images[${index + 1}]`)
    .join(", ");
  return args.promptSkeleton
    .replaceAll("{IMAGE_REFS}", refs)
    .replaceAll("{PRODUCT_NAME}", args.productName?.trim() || "the referenced product");
}
