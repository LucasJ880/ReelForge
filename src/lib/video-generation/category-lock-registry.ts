import type { CommerceProductMotionProfile } from "@/lib/video-generation/generic-shot-policy";

/**
 * B4 · 品类锁通用化（PRD §5.2 / M6）。
 *
 * 之前的模式：每个客户一套硬编码锁（sunnyshutter-brand-pack + client-lock-profiles），
 * 新客户要等我们写代码。现在锁是**品类的属性**：主角锁、可演示动作、禁止动作
 * 都是「这类产品」的物理事实，不是「这个客户」的偏好。
 * 新客户选品类即可获得整套锁，不再等代码。
 *
 * ⚠️ SunnyShutter 的锁值是 CEO 拍板锁定的（0719/0720 的窗主角锁与防幻视锁），
 * `window_shutters` 品类的内容必须与旧硬编码逐字一致 —— 有回归测试 deep-equal 守着。
 * 客户专属的**品牌**信息（电话、地址、尾卡文案）不进品类锁，仍在 brand pack 里；
 * 这里只收「产品物理行为」层面的约束。
 */

export const PRODUCT_CATEGORIES = [
  /// SunnyShutter 所在品类；锁值 = 旧硬编码原文
  "window_shutters",
  "roller_shades",
  "curtains",
  "furniture",
  "packaged_goods",
  /// 兜底：只有通用商业约束，没有品类专属锁
  "generic_commerce",
] as const;

export type ProductCategoryId = (typeof PRODUCT_CATEGORIES)[number];

/**
 * 各品类的产品运动约束。
 *
 * 写新品类时的判据：identityLocks 写「什么不许变形」，
 * demonstrableActions 写「这类产品真实世界里怎么被演示」，
 * forbiddenActions 写「模型爱画但物理上不会发生的动作」。
 */
const CATEGORY_PROFILES: Record<
  Exclude<ProductCategoryId, "generic_commerce">,
  CommerceProductMotionProfile
> = {
  /// ⚠️ 逐字来自旧 clientLockCommerceProductProfile("sunnyshutter")，勿改写。
  window_shutters: {
    productType: "plantation shutters",
    identityLocks: [
      "Preserve exact louver width, frame color, panel layout, hinge side, material, and proportions from the supplied references.",
      "The vertical tilt bar, when visible, remains one continuous straight rod.",
      "Keep all louvers parallel and evenly spaced; never warp frames or invent hardware.",
    ],
    demonstrableActions: [
      "swing one whole panel on its side hinges",
      "tilt all louvers together with no hands visible",
    ],
    revealTransitions: [
      "matched-angle cut from the supported before state to the referenced installed state",
      "swing one whole panel on its side hinges",
    ],
    forbiddenActions: [
      "grip or twist the tilt bar",
      "adjust one individual louver",
      "rapidly fold multiple panels",
    ],
  },
  roller_shades: {
    productType: "roller shades",
    identityLocks: [
      "Preserve exact fabric color, texture, hem bar shape, and mounting style from the supplied references.",
      "The shade tube stays horizontal; fabric hangs flat without invented wrinkles or waves.",
      "Never invent cords, chains, or valances that are not in the references.",
    ],
    demonstrableActions: [
      "lower or raise the shade smoothly in one continuous motion",
      "show light dimming as the shade lowers, no hands visible",
    ],
    revealTransitions: [
      "matched-angle cut from bare window to the referenced installed shade",
      "lower the shade from fully open to the referenced position",
    ],
    forbiddenActions: [
      "yank the fabric sideways",
      "roll the shade unevenly or diagonally",
      "flap the fabric like a flag",
    ],
  },
  curtains: {
    productType: "custom curtains",
    identityLocks: [
      "Preserve exact fabric color, pattern, pleat style, and drop length from the supplied references.",
      "Pleats stay evenly spaced; the rod or track matches the references.",
      "Never invent tiebacks, sheers, or hardware not present in the references.",
    ],
    demonstrableActions: [
      "draw the curtains open or closed in one smooth pass",
      "show fabric drape settling naturally after movement",
    ],
    revealTransitions: [
      "matched-angle cut from bare window to the referenced installed curtains",
      "draw curtains open to reveal the room",
    ],
    forbiddenActions: [
      "billow the fabric violently",
      "stretch or shrink the drop length",
      "swap the pleat style mid-shot",
    ],
  },
  furniture: {
    productType: "furniture piece",
    identityLocks: [
      "Preserve exact silhouette, leg style, upholstery color and material from the supplied references.",
      "Proportions stay fixed; never bend, melt, or re-scale parts between shots.",
      "Hardware and stitching match the references exactly.",
    ],
    demonstrableActions: [
      "open a drawer or door that the references show",
      "orbit the camera slowly around the static piece",
    ],
    revealTransitions: [
      "matched-angle cut from empty room to the referenced placed piece",
      "slow orbit ending on the product's front face",
    ],
    forbiddenActions: [
      "slide the piece across the floor by itself",
      "morph configuration (e.g., sofa to bed) unless references show it",
      "add cushions or decor onto the product",
    ],
  },
  packaged_goods: {
    productType: "packaged product",
    identityLocks: [
      "Preserve exact label artwork, cap shape, container proportions and material finish from the supplied references.",
      "Label text region must not be repainted — carry the reference pixels.",
      "Never invent flavor variants, sizes, or multipacks not in the references.",
    ],
    demonstrableActions: [
      "rotate the package to show the front label",
      "place the package onto a surface with a gentle settle",
    ],
    revealTransitions: [
      "matched-angle cut from ingredient scene to the referenced package",
      "rotate from back label to front label",
    ],
    forbiddenActions: [
      "open the package and pour unless references show contents",
      "squeeze or deform rigid containers",
      "duplicate the package into a crowd of copies",
    ],
  },
};

export function isProductCategoryId(
  value: unknown,
): value is ProductCategoryId {
  return (
    typeof value === "string" &&
    PRODUCT_CATEGORIES.includes(value as ProductCategoryId)
  );
}

/**
 * 取品类锁。`generic_commerce` 与未知品类返回 null ——
 * null 的含义是「只有通用商业约束」，与旧行为（非锁定客户不加档）一致。
 */
export function categoryLockProfile(
  category: string | null | undefined,
): CommerceProductMotionProfile | null {
  if (!category || !isProductCategoryId(category)) return null;
  if (category === "generic_commerce") return null;
  return CATEGORY_PROFILES[category];
}
