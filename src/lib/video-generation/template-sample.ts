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
] as const;

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
  "commerce-aesthetic-mood",
  "commerce-ugc-testimonial",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-unboxing-transform",
  "commerce-value-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
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
  "commerce-aesthetic-mood",
  "commerce-ugc-testimonial",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-unboxing-transform",
  "commerce-value-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
  ...EXPANSION_QA_PASSED_SLUGS,
]);
