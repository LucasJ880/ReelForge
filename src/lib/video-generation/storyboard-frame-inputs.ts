/**
 * 故事板每帧参考图编排（P02-B，纯函数）。
 *
 * 1025 真机验收：每帧入参写死「最近 2 张前帧 + 商家图，slice(0,5)」——商家传 4 张以上时，
 * 第 2 帧起只喂前 3 张实拍，前帧占掉两格；提示词里也没说清第几张是什么。这里改成一套显式规则，
 * 提示词里的 REFERENCE ROLES 序号与真正提交的图片顺序出自同一个函数，不会两处各算。
 *
 * 规则（总数 ≤ max，默认 6）：
 * 1. 商家实拍至少 min(实拍数, 3) 张排最前（产品身份优先于一切，含前帧）；
 * 2. 商品锚点切片其次（取 anchorCutoutUrls 列；P02-E 写入之前恒为空数组）；
 * 3. 主播参考图只在第 0 帧（`isFirstFrame`，含重做第 0 帧）且最多 1 张——帧是流水线提交的，
 *    前帧有没有出来不能当首帧判据；
 * 4. 前帧只留 1 张（最近一张已成功的），放最后；没有已成功的前帧就不占位；
 * 5. 还有余位时按「切片 → 更多实拍」补满。
 *
 * max 默认 6（P02-B2）：E1 实测 Shuyu 图像档 `input_images_max` 全部 = 6；提交时仍以选中套餐的
 * inputImagesMax 为准（submitShuyuImageTask 选套餐后截断，shuyu.ts 按硬顶 6 兜底截断，不再硬拒）。
 *
 * 另附出帧提示词的 5000 字预算（Shuyu 图像提示词 >5000 字硬拒且不可重试）：
 * STORY CONTEXT 在建 run 时按「5000 − 固定行 − REFERENCE ROLES 最坏长度 − PRESENTER LOCK − 重做余量」截断，
 * 提交前再按同一上限兜底一次。
 *
 * 纯数据模块：服务端 storyboard-service 与测试共用，不得引入服务端依赖。
 */

export const STORYBOARD_FRAME_INPUT_IMAGES_DEFAULT_MAX = 6;
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
  /// 商品锚点切片（StoryboardRun.anchorCutoutUrls；P02-E 之前恒空）
  anchorCutouts?: readonly string[];
  /// 主播参考图 URL（按 StoryboardRun.personAssetIds 解析，首张 = 主播）
  personImages?: readonly string[];
  /// 已成功的前帧输出，按 ordinal 升序；为空表示前帧还没出来（或都失败了），只影响 prior_frame 槽位
  priorFrames: readonly string[];
  /// 是否第 0 帧（含重做第 0 帧）：只有它带主播参考图
  isFirstFrame: boolean;
  /// 供应商单次可接受的参考图上限；缺省 6（E1：Shuyu 图像档 input_images_max）
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

  const guaranteedProducts = products.slice(
    0,
    Math.min(products.length, STORYBOARD_FRAME_GUARANTEED_PRODUCT_IMAGES, max),
  );
  let remaining = max - guaranteedProducts.length;

  const priorFrame = priors.length > 0 && remaining > 0 ? [priors[priors.length - 1]] : [];
  remaining -= priorFrame.length;

  const person = input.isFirstFrame && persons.length > 0 && remaining > 0 ? [persons[0]] : [];
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
    isFirstFrame: input.ordinal === 0,
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

/**
 * 镜头卡标了「换地点」的帧（2026-10-29）：连续性锁换成这一行，前帧只管人、衣着与光线，不再要求同一个房间——
 * 否则「同一房间」与镜头卡的新地点在同一段提示词里打架。判据就是这一行本身，提交与重做都不用新列。
 * 前帧说明比原文短，REFERENCE ROLES 的最坏长度（故事预算）不变。
 */
export const STORYBOARD_NEW_LOCATION_CONTINUITY_LOCK =
  "CONTINUITY LOCK: this frame hard-cuts to a new location — keep the same person identity, wardrobe, product identity, camera language and lighting style as the earlier frames, but not their room; change only what the shot card changes.";
const PRIOR_FRAME_NEW_LOCATION_DESCRIPTION =
  "previous storyboard keyframe — same person, wardrobe and light only; this frame is a new location, not its room";

/** 入参为空（纯文字起稿）时返回 null：没有图片就不写 REFERENCE ROLES 行。 */
export function storyboardReferenceRolesLine(
  images: readonly StoryboardFrameInputImage[],
  options: { newLocation?: boolean } = {},
): string | null {
  if (images.length === 0) return null;
  const describe = (role: StoryboardFrameInputRole) =>
    role === "prior_frame" && options.newLocation ? PRIOR_FRAME_NEW_LOCATION_DESCRIPTION : ROLE_DESCRIPTION[role];
  return `${STORYBOARD_REFERENCE_ROLES_PREFIX} ${images
    .map((image, index) => `image ${index + 1} = ${describe(image.role)}`)
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
  const rolesLine = storyboardReferenceRolesLine(images, {
    newLocation: lines.includes(STORYBOARD_NEW_LOCATION_CONTINUITY_LOCK),
  });
  const inserted: string[] = [];
  if (rolesLine) inserted.push(rolesLine);
  if (images.some((image) => image.role === "person")) inserted.push(STORYBOARD_PRESENTER_LOCK);
  if (inserted.length === 0) return lines.join("\n");
  const anchor = lines.findIndex((line) => line.startsWith(PRODUCT_IDENTITY_LOCK_PREFIX));
  if (anchor === -1) return [...lines, ...inserted].join("\n");
  return [...lines.slice(0, anchor), ...inserted, ...lines.slice(anchor)].join("\n");
}

// ---------------------------------------------------------------------------
// 出帧提示词长度预算
// ---------------------------------------------------------------------------

/// Shuyu 图像提示词上限（shuyu.ts preflight：>5000 字硬拒、不可重试）。
export const STORYBOARD_FRAME_PROMPT_LIMIT = 5000;
export const STORYBOARD_STORY_CONTEXT_PREFIX =
  "STORY CONTEXT (continuity only — do not depict the other beats in this image): ";
/// 重做一帧时的尾行。P05-A 起重做从 plan 重建提示词、只带这一行一次；建 run 的预算仍按 3 次留余量，
/// 兜住 P05-A 之前按旧逻辑累加过的帧行。
export const STORYBOARD_REGENERATION_LINE =
  "REGENERATION: create a distinct but continuity-faithful alternative for this same beat.";

/// 重做一帧时用户补充的要求（P05-A）：路由 zod 与创作台输入框共用这两个上限。
export const STORYBOARD_FRAME_DIRECTION_MAX = 1000;
export const STORYBOARD_FRAME_SOURCE_ASSETS_MAX = 5;
export const STORYBOARD_USER_DIRECTION_PREFIX =
  "USER DIRECTION (this frame only; never overrides PRODUCT IDENTITY LOCK): ";

/**
 * 用户补充要求压成一行（换行会被当成新的提示词行，可能伪造 REFERENCE ROLES 等行），按 UTF-16 上限截断；
 * 空白返回 null。每次重做只带最新一条——提示词从 plan 重建，旧要求自然消失。
 */
export function storyboardUserDirectionLine(direction: string | null | undefined): string | null {
  const text = truncateStoryText((direction ?? "").replace(/\s+/gu, " ").trim(), STORYBOARD_FRAME_DIRECTION_MAX);
  return text ? `${STORYBOARD_USER_DIRECTION_PREFIX}${text}` : null;
}
/// 换行与零碎标点的安全余量。
const STORY_BUDGET_SAFETY = 40;

/** 最坏情况的 REFERENCE ROLES 行：max 张图全是描述最长的那种角色。 */
export function worstCaseStoryboardReferenceRolesLine(maxInputImages: number): string {
  const longest = Object.values(ROLE_DESCRIPTION).reduce((a, b) => (b.length > a.length ? b : a));
  const count = Math.max(1, Math.floor(maxInputImages));
  return `${STORYBOARD_REFERENCE_ROLES_PREFIX} ${Array.from(
    { length: count },
    (_, index) => `image ${index + 1} = ${longest}`,
  ).join("; ")}.`;
}

/**
 * STORY CONTEXT 可用字数 = 5000 − 固定行 − REFERENCE ROLES 最坏长度 − PRESENTER LOCK − regenerations 次重做追加行 − 余量。
 * fixedPromptLength 是「故事为空」时整段提示词的长度（含 STORY CONTEXT 前缀与所有换行）。
 */
export function storyboardFrameStoryBudget(input: {
  fixedPromptLength: number;
  maxInputImages: number;
  regenerations: number;
}): number {
  const reserved =
    input.fixedPromptLength +
    worstCaseStoryboardReferenceRolesLine(input.maxInputImages).length + 1 +
    STORYBOARD_PRESENTER_LOCK.length + 1 +
    Math.max(0, Math.floor(input.regenerations)) * (STORYBOARD_REGENERATION_LINE.length + 1) +
    STORY_BUDGET_SAFETY;
  return Math.max(0, STORYBOARD_FRAME_PROMPT_LIMIT - reserved);
}

/** 按 UTF-16 长度预算截断，但不在代理对中间切开。 */
export function truncateStoryText(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  let out = Array.from(text).slice(0, budget).join("");
  while (out.length > budget) out = Array.from(out).slice(0, -1).join("");
  return out;
}

/**
 * 提交前的兜底：超过上限就先缩 STORY CONTEXT（锁行与 REFERENCE ROLES 原样保留），
 * 没有故事行可缩才硬截——那是旧数据或手工提示词，调用方应记日志。
 */
export function fitStoryboardFramePrompt(
  prompt: string,
  limit: number = STORYBOARD_FRAME_PROMPT_LIMIT,
): string {
  if (prompt.length <= limit) return prompt;
  const lines = prompt.split("\n");
  const storyAt = lines.findIndex((line) => line.startsWith(STORYBOARD_STORY_CONTEXT_PREFIX));
  if (storyAt !== -1) {
    const overflow = prompt.length - limit;
    const story = lines[storyAt].slice(STORYBOARD_STORY_CONTEXT_PREFIX.length);
    lines[storyAt] = `${STORYBOARD_STORY_CONTEXT_PREFIX}${truncateStoryText(story, story.length - overflow)}`;
    const fitted = lines.join("\n");
    if (fitted.length <= limit) return fitted;
    return fitted.slice(0, limit);
  }
  return prompt.slice(0, limit);
}
