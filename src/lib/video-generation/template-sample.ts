/**
 * A template only has a verified sample when its preview asset is dedicated to
 * that exact template slug. Reusing another template's still is useful while
 * authoring, but must never be presented to customers as a generated sample.
 */
export function verifiedTemplateSample(
  slug: string,
  coverImage: string,
): string | null {
  const expected = `/template-previews/${slug}.jpg`;
  /// 白名单与 mp4 同构：路径命中但资产未随部署提交（例如模板已 seed、样片
  /// 尚未通过真机验收）时必须返回 null，否则前端会挂着「生成样例帧」徽标
  /// 展示一张 404 的图。
  return coverImage === expected && VERIFIED_TEMPLATE_SAMPLE_SLUGS.has(slug)
    ? coverImage
    : null;
}

/**
 * 2026-08-03 扩容批次——只收真机样片逐条 QA 通过的 slug。
 * 验收记录:docs/acceptance/2026-08-03-template-expansion-acceptance.md。
 * 其余扩容模板在供应商恢复、样片过检前不得进入下方两个名单。
 */
const EXPANSION_QA_PASSED_SLUGS = [
  "commerce-talking-head-review",
  "commerce-podcast-authority",
  "commerce-founder-story",
  "commerce-street-interview",
  "commerce-hook-face-demo",
  "commerce-variant-lineup",
  "commerce-whats-in-box",
  "commerce-in-hand-scale",
  "commerce-beauty-texture",
  /// 0804 第二轮真机 QA 通过
  "commerce-macro-texture-asmr",
  "commerce-tech-feature-focus",
  "commerce-morning-routine",
  "commerce-travel-pack-flow",
  /// 0804 第三轮(收割机进程清场后)真机 QA 通过
  "commerce-creator-reaction",
  "commerce-dark-luxury-light",
  "commerce-pov-immersive",
  "commerce-360-hero-orbit",
  "commerce-before-after-match",
  /// 1025 第四轮:r7 真机成片逐条 QA 通过(穿搭动线、萌宠陪伴未过,见验收记录)
  "commerce-outdoor-rugged",
  "commerce-food-sizzle",
  /// 1026 整合轮 C5:框架 v2 重出、逐条 QA 通过(一物双景、礼盒、UGC 口碑、开箱转化、价值感未过,见验收记录)
  "commerce-pet-companion",
  "commerce-triple-proof",
  "commerce-aesthetic-mood",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
] as const;

/**
 * 1025 撤榜：首发 8 个 commerce-*（aesthetic-mood、ugc-testimonial、demo-first-reveal、
 * single-feature-proof、unboxing-transform、value-proof、problem-solution、
 * hard-sell-presenter）的 jpg / mp4 与旧模板预览逐字节相同（md5 一致，16 对文件），
 * 不是这些配方的真机样片——「高转化主持带货」挂的是一只猫。框架版本 2 上线后
 * 重出、逐条 QA 通过再回到下面两份名单；文件本身暂留在 public/，不再对外展示。
 * 门禁：tests/template-sample-whitelist.test.ts 要求名单内文件存在且 md5 两两不同。
 */

/** Slugs whose /template-previews/<slug>.jpg still is committed and QA-passed. */
const VERIFIED_TEMPLATE_SAMPLE_SLUGS = new Set([
  "before-after-reversal",
  "dark-luxury-lighting",
  "fast-commerce-beats",
  "lifestyle-use-demo",
  "macro-material-study",
  "rhythmic-unboxing",
  "slow-360-orbit",
  "street-style-placement",
  "ugc-handheld-review",
  "white-studio-standard",
  ...EXPANSION_QA_PASSED_SLUGS,
]);

/** Only same-origin MP4 assets named for the exact template are customer-safe. */
export function verifiedTemplateVideo(
  slug: string,
  sampleVideo: string | null | undefined,
): string | null {
  const expected = `/template-previews/${slug}.mp4`;
  return sampleVideo === expected && VERIFIED_TEMPLATE_VIDEO_SLUGS.has(slug)
    ? sampleVideo
    : null;
}

const VERIFIED_TEMPLATE_VIDEO_SLUGS = new Set([
  "before-after-reversal",
  "dark-luxury-lighting",
  "fast-commerce-beats",
  "lifestyle-use-demo",
  "macro-material-study",
  "rhythmic-unboxing",
  "slow-360-orbit",
  "street-style-placement",
  "ugc-handheld-review",
  "white-studio-standard",
  ...EXPANSION_QA_PASSED_SLUGS,
]);

/** 已过真机验收、可对外展示的模板样片 slug（登录门等公开面只从这里取）。 */
export function hasVerifiedTemplateVideo(slug: string): boolean {
  return VERIFIED_TEMPLATE_VIDEO_SLUGS.has(slug);
}

/** 两份白名单的只读快照：给门禁测试核对文件存在与 md5 唯一，不用于运行时判断。 */
export function verifiedTemplatePreviewSlugs(): {
  images: readonly string[];
  videos: readonly string[];
} {
  return {
    images: [...VERIFIED_TEMPLATE_SAMPLE_SLUGS],
    videos: [...VERIFIED_TEMPLATE_VIDEO_SLUGS],
  };
}

/**
 * 公开面（登录门、公开首页）上墙的样片：必须在白名单里，且 1025 质量复看的
 * 3 秒预览窗口内零可见瑕疵（无鬼影、无换人、无细节漂移）。换之前先逐帧复看。
 */
export const SHOWCASE_SAFE_SLUGS = [
  "commerce-outdoor-rugged",
  "commerce-food-sizzle",
  "commerce-beauty-texture",
] as const;
