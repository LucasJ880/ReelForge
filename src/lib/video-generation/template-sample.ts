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
  return coverImage === expected ? coverImage : null;
}

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
]);
