/**
 * 批量生成模板种子与纯填空渲染器。
 *
 * INV-B1：批量视频 prompt 只能由这里的 promptSkeleton 做确定性填空。
 * 生成关键路径不 import OpenAI，也不接受客户端传入任意 prompt。
 */

export interface BatchStyleLockedParams {
  duration: 5 | 10 | 15;
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: "720p" | "1080p";
  cameraStyle: string;
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
  "Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame.";

export const BATCH_STYLE_TEMPLATE_SEEDS: BatchStyleTemplateSeed[] = [
  {
    slug: "slow-360-orbit",
    version: 1,
    name: "Slow 360 Product Orbit",
    nameZh: "360 慢旋转展示",
    category: "电商展示",
    coverImage: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Create a seamless slow 360-degree clockwise orbit around the hero product on a minimal pedestal. Start at a three-quarter front angle, ease around the side and finish on the opposite three-quarter angle. Large softbox key light at 45 degrees, clean rim light tracing the silhouette, soft neutral fill, smooth controlled highlights. Calm premium pacing with one continuous stabilized move and a gentle final hold.",
    negativePrompt:
      "product morphing, changing proportions, duplicate product, warped sole, sole deformation, bent heel, label blur, unreadable logo, flicker, camera shake, abrupt cuts, text overlay",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "motorized slow orbit" },
    imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "macro-material-study",
    version: 1,
    name: "Macro Material Study",
    nameZh: "微距质感特写",
    category: "质感特写",
    coverImage: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Film an extreme macro material study: glide across surface texture, rack focus onto one craftsmanship detail, then pull back just enough to reveal the product identity. Narrow diffused strip light skims the surface, dark negative fill creates depth, tiny specular accents reveal material quality. Slow tactile rhythm, two deliberate focus transitions, no rushed motion.",
    negativePrompt:
      "soft focus, waxy material, fake texture, excessive bloom, warped stitching, sole deformation, label blur, melted edges, macro noise, focus pumping, text overlay",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "macro slider and rack focus" },
    imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "street-style-placement",
    version: 1,
    name: "Street Style Placement",
    nameZh: "街拍场景植入",
    category: "生活方式",
    coverImage: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Place the product naturally in an energetic urban street-style scene. Track beside the subject at walking speed, cut to a low-angle product hero insert, then whip-pan back to the lifestyle wide shot. Late-afternoon directional sunlight, realistic bounce from storefronts, crisp edge light, natural street shadows. Confident medium-fast pacing with match-on-action cuts.",
    negativePrompt:
      "floating product, incorrect scale, warped limbs, extra fingers, duplicate people, sole deformation, label blur, oversaturated skin, unstable background, random signage, text overlay",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "handheld gimbal street tracking" },
    imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "ugc-handheld-review",
    version: 1,
    name: "UGC Handheld Review",
    nameZh: "UGC 手持口播风",
    category: "UGC",
    coverImage: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Create an authentic creator-style handheld product review without generated dialogue: selfie-height establishing shot, hand brings the product close to camera, quick cut to a practical use demonstration, then an enthusiastic reaction hold. Soft window key light, warm household practicals, natural exposure roll-off. Conversational rhythm with subtle handheld micro-movement and clean jump cuts.",
    negativePrompt:
      "lip-sync speech, generated captions, extra fingers, fused fingers, deformed hands, floating product, beauty filter, label blur, logo mutation, aggressive camera shake, text overlay",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "authentic handheld creator camera" },
    imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "rhythmic-unboxing",
    version: 1,
    name: "Rhythmic Unboxing",
    nameZh: "开箱节奏剪辑",
    category: "开箱",
    coverImage: "https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Stage a locked-camera top-down rhythmic unboxing: sealed package enters frame, hands open it in two precise actions, product reveal lands on the beat, macro camera inserts follow, ending with the complete set arranged neatly. Broad overhead soft light, controlled side fill, clean white balance and defined contact shadows. Fast satisfying pacing with five beat-matched cuts and a one-second hero hold.",
    negativePrompt:
      "extra fingers, fused hands, impossible box folds, teleporting objects, duplicate accessories, label blur, warped packaging, missing product parts, motion smear, text overlay",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked top-down with macro inserts" },
    imagesPerVideo: { min: 3, max: 4 },
  },
  {
    slug: "white-studio-standard",
    version: 1,
    name: "White Studio Standard",
    nameZh: "白棚电商标准",
    category: "电商展示",
    coverImage: "https://images.unsplash.com/photo-1560343090-f0409e92791a?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Produce a clean white cyclorama ecommerce video: centered front hero shot, smooth 30-degree lateral slider move, top-detail insert, then return to a symmetrical packshot. High-key three-point soft lighting, pure white sweep with a subtle grounded contact shadow, accurate color and neutral reflections. Even catalog pacing with precise one-second holds on every key view.",
    negativePrompt:
      "clipped whites, grey dirty background, floating object, incorrect color, warped silhouette, sole deformation, label blur, unreadable logo, harsh shadow, camera shake, text overlay",
    lockedParams: { duration: 10, aspectRatio: "1:1", resolution: "1080p", cameraStyle: "precision studio slider" },
    imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "dark-luxury-lighting",
    version: 1,
    name: "Dark Luxury Lighting",
    nameZh: "暗调奢品布光",
    category: "奢品",
    coverImage: "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Craft a dark luxury reveal: begin in near silhouette, send a narrow light sweep across the signature detail, execute a slow low-angle push-in, and finish on a polished hero frame. Black velvet environment, hard controlled rim lights, narrow snooted key, subtle warm reflection beneath the product. Restrained cinematic pacing with long anticipation and a decisive final reveal.",
    negativePrompt:
      "crushed product detail, noisy blacks, cheap plastic look, excessive smoke, blown highlights, warped metal, label blur, logo mutation, flicker, fast cuts, text overlay",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "slow low-angle luxury dolly" },
    imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "lifestyle-use-demo",
    version: 1,
    name: "Lifestyle Use Demo",
    nameZh: "生活场景使用演示",
    category: "使用演示",
    coverImage: "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Demonstrate the product solving one everyday task in a believable home: establish the problem, follow the hand reaching for the product, track the complete use action, then show the relaxed result. Soft directional daylight through a window, warm practical background lights, realistic skin and material response. Clear problem-action-result pacing with continuity-matched cuts.",
    negativePrompt:
      "extra fingers, fused fingers, impossible interaction, product changing size, duplicate product, label blur, liquid leaks, discontinuous action, cluttered frame, text overlay",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "eye-level gimbal demonstration" },
    imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "fast-commerce-beats",
    version: 1,
    name: "Fast Commerce Beats",
    nameZh: "快节奏带货卡点",
    category: "爆款广告",
    coverImage: "https://images.unsplash.com/photo-1607083206968-13611e3d76db?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Build a high-retention commerce montage: snap zoom to hero product, three rapid feature close-ups from distinct angles, hand-in-use proof shot, then a clean final packshot. Bright punchy softbox lighting, colored edge accents, high local contrast without clipping. Very fast beat-driven pacing, cuts every 0.8-1.2 seconds, motion-match transitions, readable final hold.",
    negativePrompt:
      "random text, generated price tags, product morphing, duplicate product, extra fingers, sole deformation, label blur, unreadable logo, chaotic framing, strobe flicker, excessive motion blur",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "snap zoom and motion-match cuts" },
    imagesPerVideo: { min: 3, max: 4 },
  },
  {
    slug: "before-after-reversal",
    version: 1,
    name: "Before After Reversal",
    nameZh: "对比前后反转",
    category: "对比转化",
    coverImage: "https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=800&q=80",
    promptSkeleton:
      `${COMMON} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ` +
      "Create a locked-camera before/after reversal: show the unsolved situation for two seconds, introduce the product with a centered match cut, demonstrate one decisive action, then reveal the improved result from the exact same camera position. Before uses flat cool light; after shifts to soft warm key and brighter fill while preserving spatial continuity. Tension-release rhythm with a sharp midpoint transformation.",
    negativePrompt:
      "camera position drift, inconsistent room geometry, fake split screen, product shape change, duplicate objects, extra fingers, label blur, overdone glow, random text, text overlay",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked tripod match-cut comparison" },
    imagesPerVideo: { min: 2, max: 3 },
  },
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
