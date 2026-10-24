import {
  COMMERCE_TEMPLATE_RECIPES,
  getCommerceTemplateRecipe,
  type CommerceSubjectLock,
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
export const COMMERCE_FRAME_REVISION = 2;

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
- Follow the three timed beats exactly: hook, proof, CTA hold. The first second always shows the product's strongest visible state.
- One primary buying reason per video. Return to a complete product hero before the end; the final hold lasts two seconds, not longer.
PRODUCTION LOCK:
- Photorealistic real-footage look, stable identity, coherent room and cast, clean commercial light, controlled camera, decisive pacing.
- One single full-bleed camera view on screen at every moment; never split screen, grid, collage, tiled panels, or picture-in-picture.
- Hard cuts only: every cut goes instantly from one complete shot to the next. No crossfades, dissolves, double exposure, ghosting, or superimposed transitions.
- Props and set dressing stay generic and unbranded: no third-party logos or recognizable branded items, no mannequins or body-part display props.
- Voice is optional and added natively by Seedance. Do not generate a music bed.
- No on-screen text, captions, prices, logos, URLs, QR codes, UI, or watermarks; captions and brand packaging are added in post.`;

const GENERIC_NEGATIVE =
  "product morphing, invented features, wrong color, wrong material, missing parts, duplicate product, warped packaging, unreadable labels, fake before after, unsupported claims, distorted hands, extra fingers, floating objects, geometry drift, scene discontinuity, burned-in text, captions, prices, logos, QR codes, URLs, watermarks, split screen, grid collage, tiled panels, picture-in-picture, mannequin body parts, third-party brand marks, crossfade, dissolve, double exposure, ghosting, superimposed transition";

/// 单一主体锁（rev2）：有人（含只出手）/ 有宠物的配方把身份特征写死，并给该配方
/// 追加对应负面词。1025 质量复看实锤：creator-reaction 3s 与 9.5s 是两个不同的人，
/// pov 换了 4 次衣服，萌宠 0s 是贵宾、1–4s 变金毛。
const SUBJECT_LOCKS: Record<
  CommerceSubjectLock,
  { prompt: string; negative: string }
> = {
  person: {
    prompt:
      "SUBJECT LOCK: at most one person in the whole video, hands included. Face, age, skin tone, hair, outfit, sleeves, nails, and accessories are fixed at first appearance and identical in every shot; never swap, add, or restyle the person.",
    negative:
      "second person, different person, face change, identity drift, wardrobe change, sleeve change, hairstyle change",
  },
  pet: {
    prompt:
      "SUBJECT LOCK: exactly one animal in the whole video. Species, breed, size, coat color, markings, and collar are fixed at first appearance and identical in every shot; never swap or add an animal. Any human is one person's hands with unchanged skin tone and sleeves.",
    negative:
      "second animal, different pet, breed change, coat color change, changing markings, second person",
  },
};

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
    ...(recipe.subjectLock ? [SUBJECT_LOCKS[recipe.subjectLock].prompt] : []),
    `CAMERA: ${recipe.cameraStyle}.`,
    "LIGHT: motivated commercial daylight or soft studio key, controlled fill, realistic contact shadows, no fantasy glow.",
    "PACING: strongest product state in the first second, readable proof beat, two-second final product hold, hard cuts only.",
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
    /// 每次修订全目录 +1——框架进 promptSkeleton，任何框架改动都改变全部
    /// 模板的骨架，必须整体升版并重 seed，否则 DB ACTIVE 行与代码骨架漂移。
    /// 2026-08-03 rev1：单画幅铁律 + 道具纪律（拼贴/人台/第三方 logo 真机复现）。
    /// 2026-10-25 rev2：只许硬切（鬼影集中在 10–12s 转入收尾定帧的叠化处，34 个
    /// 配方此前只有 2 个禁了叠化）；节拍改 0-3 / 3-13 / 13-15s（收尾定格 5s→2s），
    /// 钩子第一秒就是产品最强的一面；人物 / 宠物配方加单一主体锁。配方自身的
    /// version 不动，靠本修订号整体 +1；重 seed 由主线程在发布阶段先 dry-run 再跑。
    version: (recipe.version ?? 1) + COMMERCE_FRAME_REVISION,
    name: recipe.name,
    nameZh: recipe.nameZh,
    category: recipe.category,
    coverImage: recipe.coverImage,
    promptSkeleton,
    negativePrompt: recipe.subjectLock
      ? `${GENERIC_NEGATIVE}, ${SUBJECT_LOCKS[recipe.subjectLock].negative}`
      : GENERIC_NEGATIVE,
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
