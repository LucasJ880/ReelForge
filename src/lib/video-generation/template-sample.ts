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
  return sampleVideo === expected ? sampleVideo : null;
}
