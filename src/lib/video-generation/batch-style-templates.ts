/**
 * 批量生成模板种子与纯填空渲染器。
 *
 * INV-B1：批量视频 prompt 只能由这里的 promptSkeleton 做确定性填空。
 * 生成关键路径不 import OpenAI，也不接受客户端传入任意 prompt。
 */

import { EXPANDED_BATCH_STYLE_TEMPLATE_SEEDS } from "@/lib/video-generation/batch-style-template-expansion";

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

const COMMON =
  "Use only the supplied product reference images as visual truth. Preserve product geometry, count, color, material, packaging, logos and proportions in every frame. Never invent an unseen side or feature; keep the camera within evidence shown by the references. Keep one product unless the references clearly show a set. Do not generate new lettering, labels, prices, badges or logos. Lock the product identity, background layout, light direction and contact shadow across every shot. Any hand or body interaction must remain anatomically plausible and may never hide the product's defining features.";

const CORE_BATCH_STYLE_TEMPLATE_SEEDS: BatchStyleTemplateSeed[] = [
  {
    slug: "slow-360-orbit",
    version: 3,
    name: "Slow 360 Product Orbit",
    nameZh: "360 慢旋转展示",
    category: "电商展示",
    coverImage: "/template-previews/slow-360-orbit.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Create a seamless slow 360-degree clockwise orbit around the hero product on a minimal pedestal. Start at a three-quarter front angle, ease around the side and finish on the opposite three-quarter angle. Large softbox key light at 45 degrees, clean rim light tracing the silhouette, soft neutral fill, smooth controlled highlights. Calm premium pacing with one continuous stabilized move and a gentle final hold.",
    negativePrompt:
      "product morphing, changing proportions, duplicate product, invented rear details, label mutation, logo mutation, floating object, flicker, camera shake, abrupt cuts, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "motorized slow orbit", stability: "high", humanInteraction: "none" },
    imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "macro-material-study",
    version: 3,
    name: "Macro Material Study",
    nameZh: "微距质感特写",
    category: "质感特写",
    coverImage: "/template-previews/macro-material-study.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Film an extreme macro material study: glide across surface texture, rack focus onto one craftsmanship detail, then pull back just enough to reveal the product identity. Narrow diffused strip light skims the surface, dark negative fill creates depth, tiny specular accents reveal material quality. Slow tactile rhythm, two deliberate focus transitions, no rushed motion.",
    negativePrompt:
      "soft focus, waxy material, fake texture, invented surface detail, excessive bloom, warped seams, label mutation, melted edges, macro noise, focus pumping, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "macro slider and rack focus", stability: "high", humanInteraction: "none" },
    imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "street-style-placement",
    version: 3,
    name: "Street Style Placement",
    nameZh: "街拍场景植入",
    category: "生活方式",
    coverImage: "/template-previews/street-style-placement.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Place the product naturally in an energetic urban street-style scene. Track beside the subject at walking speed, cut to a low-angle product hero insert, then whip-pan back to the lifestyle wide shot. Late-afternoon directional sunlight, realistic bounce from storefronts, crisp edge light, natural street shadows. Confident medium-fast pacing with match-on-action cuts.",
    negativePrompt:
      "floating product, incorrect scale, warped limbs, extra fingers, duplicate people, product deformation, label mutation, oversaturated skin, unstable background, random signage, generated text",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "handheld gimbal street tracking", stability: "balanced", humanInteraction: "controlled" },
    imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "ugc-handheld-review",
    version: 3,
    name: "UGC Handheld Review",
    nameZh: "UGC 手持口播风",
    category: "UGC",
    coverImage: "/template-previews/ugc-handheld-review.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Create an authentic creator-style handheld product review without generated dialogue: selfie-height establishing shot, hand brings the product close to camera, quick cut to a practical use demonstration, then an enthusiastic reaction hold. Soft window key light, warm household practicals, natural exposure roll-off. Conversational rhythm with subtle handheld micro-movement and clean jump cuts.",
    negativePrompt:
      "lip-sync speech, generated captions, extra fingers, fused fingers, deformed hands, floating product, beauty filter, label blur, logo mutation, aggressive camera shake, text overlay",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "authentic handheld creator camera", stability: "balanced", humanInteraction: "controlled" },
    imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "rhythmic-unboxing",
    version: 3,
    name: "Rhythmic Unboxing",
    nameZh: "开箱节奏剪辑",
    category: "开箱",
    coverImage: "/template-previews/rhythmic-unboxing.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Stage a locked-camera top-down rhythmic unboxing: sealed package enters frame, hands open it in two precise actions, product reveal lands on the beat, macro camera inserts follow, ending with the complete set arranged neatly. Broad overhead soft light, controlled side fill, clean white balance and defined contact shadows. Fast satisfying pacing with five beat-matched cuts and a one-second hero hold.",
    negativePrompt:
      "extra fingers, fused hands, impossible box folds, teleporting objects, duplicate accessories, label blur, warped packaging, missing product parts, motion smear, text overlay",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked top-down with macro inserts", stability: "balanced", humanInteraction: "controlled" },
    imagesPerVideo: { min: 3, max: 4 },
  },
  {
    slug: "white-studio-standard",
    version: 3,
    name: "White Studio Standard",
    nameZh: "白棚电商标准",
    category: "电商展示",
    coverImage: "/template-previews/white-studio-standard.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Produce a clean white cyclorama ecommerce video: centered front hero shot, smooth 30-degree lateral slider move, top-detail insert, then return to a symmetrical packshot. High-key three-point soft lighting, pure white sweep with a subtle grounded contact shadow, accurate color and neutral reflections. Even catalog pacing with precise one-second holds on every key view.",
    negativePrompt:
      "clipped whites, grey dirty background, floating object, incorrect color, warped silhouette, invented product details, label mutation, logo mutation, harsh shadow, camera shake, generated text",
    lockedParams: { duration: 10, aspectRatio: "1:1", resolution: "1080p", cameraStyle: "precision studio slider", stability: "high", humanInteraction: "none" },
    imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "dark-luxury-lighting",
    version: 3,
    name: "Dark Luxury Lighting",
    nameZh: "暗调奢品布光",
    category: "奢品",
    coverImage: "/template-previews/dark-luxury-lighting.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Craft a dark luxury reveal: begin in near silhouette, send a narrow light sweep across the signature detail, execute a slow low-angle push-in, and finish on a polished hero frame. Black velvet environment, hard controlled rim lights, narrow snooted key, subtle warm reflection beneath the product. Restrained cinematic pacing with long anticipation and a decisive final reveal.",
    negativePrompt:
      "crushed product detail, noisy blacks, cheap plastic look, excessive smoke, blown highlights, warped metal, label blur, logo mutation, flicker, fast cuts, text overlay",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "slow low-angle luxury dolly", stability: "high", humanInteraction: "none" },
    imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "lifestyle-use-demo",
    version: 3,
    name: "Lifestyle Use Demo",
    nameZh: "生活场景使用演示",
    category: "使用演示",
    coverImage: "/template-previews/lifestyle-use-demo.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Demonstrate the product solving one everyday task in a believable home: establish the problem, follow the hand reaching for the product, track the complete use action, then show the relaxed result. Soft directional daylight through a window, warm practical background lights, realistic skin and material response. Clear problem-action-result pacing with continuity-matched cuts.",
    negativePrompt:
      "extra fingers, fused fingers, impossible interaction, product changing size, duplicate product, label blur, liquid leaks, discontinuous action, cluttered frame, text overlay",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "eye-level gimbal demonstration", stability: "balanced", humanInteraction: "controlled" },
    imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "fast-commerce-beats",
    version: 3,
    name: "Fast Commerce Beats",
    nameZh: "快节奏带货卡点",
    category: "爆款广告",
    coverImage: "/template-previews/fast-commerce-beats.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Build a high-retention commerce montage: snap zoom to hero product, three rapid feature close-ups from distinct angles, hand-in-use proof shot, then a clean final packshot. Bright punchy softbox lighting, colored edge accents, high local contrast without clipping. Very fast beat-driven pacing, cuts every 0.8-1.2 seconds, motion-match transitions, readable final hold.",
    negativePrompt:
      "random text, generated price tags, product morphing, duplicate product, extra fingers, product deformation, label mutation, logo mutation, chaotic framing, strobe flicker, excessive motion blur",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "snap zoom and motion-match cuts", stability: "balanced", humanInteraction: "controlled" },
    imagesPerVideo: { min: 3, max: 4 },
  },
  {
    slug: "before-after-reversal",
    version: 3,
    name: "Before After Reversal",
    nameZh: "对比前后反转",
    category: "对比转化",
    coverImage: "/template-previews/before-after-reversal.jpg",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Create a locked-camera before/after reversal: show the unsolved situation for two seconds, introduce the product with a centered match cut, demonstrate one decisive action, then reveal the improved result from the exact same camera position. Before uses flat cool light; after shifts to soft warm key and brighter fill while preserving spatial continuity. Tension-release rhythm with a sharp midpoint transformation.",
    negativePrompt:
      "camera position drift, inconsistent room geometry, fake split screen, product shape change, duplicate objects, extra fingers, label blur, overdone glow, random text, text overlay",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked tripod match-cut comparison", stability: "balanced", humanInteraction: "controlled" },
    imagesPerVideo: { min: 2, max: 3 },
  },
];

export const BATCH_STYLE_TEMPLATE_SEEDS: BatchStyleTemplateSeed[] = [
  ...CORE_BATCH_STYLE_TEMPLATE_SEEDS,
  ...EXPANDED_BATCH_STYLE_TEMPLATE_SEEDS,
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
  const refs = args.imageUrls
    .map((url, index) => `Image ${index + 1}: ${url}`)
    .join("; ");
  return args.promptSkeleton
    .replaceAll("{IMAGE_REFS}", refs)
    .replaceAll("{PRODUCT_NAME}", args.productName?.trim() || "the referenced product");
}
