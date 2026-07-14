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
