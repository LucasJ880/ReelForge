/**
 * 故事板每帧参考图编排（P02-B，纯函数）。
 *
 * 1025 真机验收：每帧入参写死「最近 2 张前帧 + 商家图，slice(0,5)」——商家传 4 张以上时，
 * 第 2 帧起只喂前 3 张实拍，前帧占掉两格；提示词里也没说清第几张是什么。这里改成一套显式规则，
 * 提示词里的 REFERENCE ROLES 序号与真正提交的图片顺序出自同一个函数，不会两处各算。
 *
 * 规则（总数 ≤ max，默认 5）：
 * 1. 商家实拍至少 min(实拍数, 3) 张排最前；
 * 2. 商品锚点切片其次（本阶段恒为空数组，P02-F(s) 接 anchorCutoutUrls 列）；
 * 3. 主播参考图只在首帧（还没有已成功的前帧）且最多 1 张；
 * 4. 前帧只留 1 张（最近一张已成功的），放最后；
 * 5. 还有余位时按「切片 → 更多实拍」补满。
 *
 * max 默认 5：E1 实测 Shuyu 图像档 `input_images_max` 全部 = 6，但 shuyu.ts 对 >5 张仍硬拒，
 * 提到 6 留给 P02-B2（那时从套餐的 inputImagesMax 取）。
 *
 * 纯数据模块：服务端 storyboard-service 与测试共用，不得引入服务端依赖。
 */

export const STORYBOARD_FRAME_INPUT_IMAGES_DEFAULT_MAX = 5;
/// 实拍保底张数：商家传够时，任何一帧至少喂这么多张实拍（产品身份比前帧连续性优先）。
export const STORYBOARD_FRAME_GUARANTEED_PRODUCT_IMAGES = 3;

export type StoryboardFrameInputRole = "product" | "anchor_cutout" | "person" | "prior_frame";

export interface StoryboardFrameInputImage {
  url: string;
  role: StoryboardFrameInputRole;
}

export interface ComposeStoryboardFrameInputImagesInput {
  /// 商家实拍（StoryboardRun.inputImageUrls）
  productImages: readonly string[];
  /// 商品锚点切片（StoryboardRun.anchorCutoutUrls；P02-F(s) 之前恒空）
  anchorCutouts?: readonly string[];
  /// 主播参考图 URL（按 StoryboardRun.personAssetIds 解析）
  personImages?: readonly string[];
  /// 已成功的前帧输出，按 ordinal 升序
  priorFrames: readonly string[];
  /// 供应商单次可接受的参考图上限；缺省 5
  max?: number;
}

function uniqueUrls(urls: readonly string[] | undefined): string[] {
  return [...new Set((urls ?? []).map((url) => url.trim()).filter(Boolean))];
}

export function composeStoryboardFrameInputImages(
  input: ComposeStoryboardFrameInputImagesInput,
): StoryboardFrameInputImage[] {
  const max = Math.max(1, Math.floor(input.max ?? STORYBOARD_FRAME_INPUT_IMAGES_DEFAULT_MAX));
  const products = uniqueUrls(input.productImages);
  const productSet = new Set(products);
  const cutouts = uniqueUrls(input.anchorCutouts).filter((url) => !productSet.has(url));
  const persons = uniqueUrls(input.personImages);
  const priors = uniqueUrls(input.priorFrames);
  const isFirstFrame = priors.length === 0;

  const guaranteedProducts = products.slice(
    0,
    Math.min(products.length, STORYBOARD_FRAME_GUARANTEED_PRODUCT_IMAGES, max),
  );
  let remaining = max - guaranteedProducts.length;

  const priorFrame = !isFirstFrame && remaining > 0 ? [priors[priors.length - 1]] : [];
  remaining -= priorFrame.length;

  const person = isFirstFrame && persons.length > 0 && remaining > 0 ? [persons[0]] : [];
  remaining -= person.length;

  const pickedCutouts = cutouts.slice(0, Math.max(0, remaining));
  remaining -= pickedCutouts.length;

  const extraProducts = products.slice(
    guaranteedProducts.length,
    guaranteedProducts.length + Math.max(0, remaining),
  );

  return [
    ...guaranteedProducts.map((url): StoryboardFrameInputImage => ({ url, role: "product" })),
    ...extraProducts.map((url): StoryboardFrameInputImage => ({ url, role: "product" })),
    ...pickedCutouts.map((url): StoryboardFrameInputImage => ({ url, role: "anchor_cutout" })),
    ...person.map((url): StoryboardFrameInputImage => ({ url, role: "person" })),
    ...priorFrame.map((url): StoryboardFrameInputImage => ({ url, role: "prior_frame" })),
  ];
}

/**
 * 建 run 时还没有任何图片 URL（前帧还没出），用占位符按同一套规则预演第 ordinal 帧的入参布局，
 * 只为生成 REFERENCE ROLES 序号与首帧 PRESENTER LOCK。提交时按真实图片重算并对齐（applyStoryboardReferenceRoles）。
 */
export function planStoryboardFrameInputs(input: {
  ordinal: number;
  productImageCount: number;
  anchorCutoutCount?: number;
  personImageCount?: number;
  max?: number;
}): StoryboardFrameInputImage[] {
  const tokens = (prefix: string, count: number): string[] =>
    Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => `${prefix}:${index + 1}`);
  return composeStoryboardFrameInputImages({
    productImages: tokens("product", input.productImageCount),
    anchorCutouts: tokens("cutout", input.anchorCutoutCount ?? 0),
    personImages: tokens("person", input.personImageCount ?? 0),
    priorFrames: input.ordinal > 0 ? ["prior:1"] : [],
    max: input.max,
  });
}

export const STORYBOARD_REFERENCE_ROLES_PREFIX = "REFERENCE ROLES:";
export const STORYBOARD_PRESENTER_LOCK =
  "PRESENTER LOCK: the on-camera person is the exact person in the presenter reference image — same face, hair, skin tone, build and age; never invent a different person or alter their features.";

const ROLE_DESCRIPTION: Record<StoryboardFrameInputRole, string> = {
  product: "real photo of the merchant's product — match it exactly",
  anchor_cutout: "clean cutout of the product — shape, print and hardware reference",
  person: "presenter reference photo — the real on-camera person",
  prior_frame:
    "previous approved storyboard keyframe — continuity only (same room, person, wardrobe, light); do not copy its composition",
};

/** 入参为空（纯文字起稿）时返回 null：没有图片就不写 REFERENCE ROLES 行。 */
export function storyboardReferenceRolesLine(
  images: readonly StoryboardFrameInputImage[],
): string | null {
  if (images.length === 0) return null;
  return `${STORYBOARD_REFERENCE_ROLES_PREFIX} ${images
    .map((image, index) => `image ${index + 1} = ${ROLE_DESCRIPTION[image.role]}`)
    .join("; ")}.`;
}

const PRODUCT_IDENTITY_LOCK_PREFIX = "PRODUCT IDENTITY LOCK:";

/**
 * 把 REFERENCE ROLES / PRESENTER LOCK 行按给定入参重写进出帧提示词（幂等）：
 * 先剥掉旧的两行，再插到 PRODUCT IDENTITY LOCK 之前（没有就追加到末尾）。
 * 建 run 时与提交时都走这里——布局一致则字符串完全相同，提交时无需回写。
 */
export function applyStoryboardReferenceRoles(
  prompt: string,
  images: readonly StoryboardFrameInputImage[],
): string {
  const lines = prompt
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith(STORYBOARD_REFERENCE_ROLES_PREFIX) &&
        !line.startsWith("PRESENTER LOCK:"),
    );
  const rolesLine = storyboardReferenceRolesLine(images);
  const inserted: string[] = [];
  if (rolesLine) inserted.push(rolesLine);
  if (images.some((image) => image.role === "person")) inserted.push(STORYBOARD_PRESENTER_LOCK);
  if (inserted.length === 0) return lines.join("\n");
  const anchor = lines.findIndex((line) => line.startsWith(PRODUCT_IDENTITY_LOCK_PREFIX));
  if (anchor === -1) return [...lines, ...inserted].join("\n");
  return [...lines.slice(0, anchor), ...inserted, ...lines.slice(anchor)].join("\n");
}
