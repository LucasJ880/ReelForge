import {
  COMMERCE_TEMPLATE_RECIPES,
  getCommerceTemplateRecipe,
  type CommerceTemplateCategory,
  type CommerceTemplateSlug,
} from "@/lib/video-generation/commerce-template-catalog";

export type CommerceTemplateSeed = {
  slug: CommerceTemplateSlug;
  version: number;
  name: string;
  nameZh: string;
  category: CommerceTemplateCategory;
  coverImage: string;
  promptSkeleton: string;
  negativePrompt: string;
  lockedParams: {
    duration: 15;
    aspectRatio: "9:16";
    resolution: "1080p";
    cameraStyle: string;
    stability: "high";
    humanInteraction: "none" | "controlled";
  };
  imagesPerVideo: { min: number; max: number };
};

/// 框架修订号；语义见 seedFor 内注释。0 = 初版框架。
const COMMERCE_FRAME_REVISION = 1;

const GENERIC_COMMERCE_FRAME = `GOAL LOCK: create a conversion-focused ecommerce video for the referenced product, not a generic mood film.
PRODUCT TRUTH LOCK:
- Supplied input images are the only visual truth. Preserve exact silhouette, geometry, color, material, proportions, visible parts, labels, package, and accessories across every shot.
- Never invent an unseen feature, control, opening, hinge, zipper, accessory, product state, certification, result, price, discount, testimonial, or competitor.
- If an action or transformation is not visibly supported by the references, keep the product static and use a camera cut instead.
- Human hands stay anatomically correct and never obscure the feature being proved. Presenter gestures must remain beside the product.
CLAIM LOCK:
- Picture proves only what can be seen. Spoken lines may explain a user benefit but cannot fabricate measured performance, medical claims, savings, ratings, guarantees, scarcity, or endorsement.
- No fake before/after CGI. Use matched context cuts only when both states are supported.
STORY LOCK:
- Follow the three timed beats exactly: hook, proof, CTA hold.
- One primary buying reason per video. Return to a complete product hero before the end.
PRODUCTION LOCK:
- Photorealistic real-footage look, stable identity, coherent room and cast, clean commercial light, controlled camera, decisive pacing.
- One single full-bleed camera view on screen at every moment; never split screen, grid, collage, tiled panels, or picture-in-picture.
- Props and set dressing stay generic and unbranded: no third-party logos or recognizable branded items, no mannequins or body-part display props.
- Voice is optional and added natively by Seedance. Do not generate a music bed.
- No on-screen text, captions, prices, logos, URLs, QR codes, UI, or watermarks; captions and brand packaging are added in post.`;

const GENERIC_NEGATIVE =
  "product morphing, invented features, wrong color, wrong material, missing parts, duplicate product, warped packaging, unreadable labels, fake before after, unsupported claims, distorted hands, extra fingers, floating objects, geometry drift, scene discontinuity, burned-in text, captions, prices, logos, QR codes, URLs, watermarks, split screen, grid collage, tiled panels, picture-in-picture, mannequin body parts, third-party brand marks";

function seedFor(
  recipe: (typeof COMMERCE_TEMPLATE_RECIPES)[number],
): CommerceTemplateSeed {
  const promptSkeleton = [
    GENERIC_COMMERCE_FRAME,
    "",
    `RECIPE: ${recipe.name}.`,
    `HOOK INTENT: ${recipe.hook}`,
    `PROOF INTENT: ${recipe.proof}`,
    `CTA INTENT: ${recipe.cta}`,
    `MOTION POLICY: ${recipe.motion}. Use only reference-supported action; otherwise replace action with a stable camera cut.`,
    `CAMERA: ${recipe.cameraStyle}.`,
    "LIGHT: motivated commercial daylight or soft studio key, controlled fill, realistic contact shadows, no fantasy glow.",
    "PACING: sharp hook beat, readable proof beat, unhurried final product hold.",
    "",
    "TIMED STORYBOARD:",
    ...recipe.beats.map((beat) => `- ${beat}`),
    "",
    "Product: {PRODUCT_NAME}.",
    "Reference slots: {IMAGE_REFS}.",
  ].join("\n");
  if (promptSkeleton.length >= 5_000) {
    throw new Error(`${recipe.slug} prompt skeleton exceeds 5000 characters`);
  }
  return {
    slug: recipe.slug,
    /// COMMERCE_FRAME_REVISION：框架文本(GENERIC_COMMERCE_FRAME / NEGATIVE)
    /// 每次修订全目录 +1——框架进 promptSkeleton，任何框架改动都改变全部 35 个
    /// 模板的骨架，必须整体升版并重 seed，否则 DB ACTIVE 行与代码骨架漂移。
    /// 2026-08-03 rev1：单画幅铁律 + 道具纪律（拼贴/人台/第三方 logo 真机复现）。
    version: (recipe.version ?? 1) + COMMERCE_FRAME_REVISION,
    name: recipe.name,
    nameZh: recipe.nameZh,
    category: recipe.category,
    coverImage: recipe.coverImage,
    promptSkeleton,
    negativePrompt: GENERIC_NEGATIVE,
    lockedParams: {
      duration: 15,
      aspectRatio: "9:16",
      resolution: "1080p",
      cameraStyle: recipe.cameraStyle,
      stability: "high",
      humanInteraction: recipe.humanInteraction,
    },
    imagesPerVideo: { min: 1, max: 4 },
  };
}

export const COMMERCE_TEMPLATE_SEEDS: CommerceTemplateSeed[] =
  COMMERCE_TEMPLATE_RECIPES.map(seedFor);

export function renderCommerceTemplate(
  slug: string,
  input: { productName?: string | null; imageUrls: string[] },
): string {
  const recipe = getCommerceTemplateRecipe(slug);
  if (!recipe) throw new Error(`Unknown commerce template: ${slug}`);
  if (input.imageUrls.length === 0) {
    throw new Error("At least one product reference image is required");
  }
  const seed = COMMERCE_TEMPLATE_SEEDS.find((item) => item.slug === recipe.slug);
  if (!seed) throw new Error(`Commerce seed is unavailable: ${slug}`);
  const refs = input.imageUrls
    .map((_, index) => `input_images[${index + 1}]`)
    .join(", ");
  return seed.promptSkeleton
    .replaceAll("{IMAGE_REFS}", refs)
    .replaceAll(
      "{PRODUCT_NAME}",
      input.productName?.trim() || "the referenced product",
    );
}
