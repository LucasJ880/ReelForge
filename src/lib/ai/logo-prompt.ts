/** Provider-neutral prompt assembly for the optional logo generation feature. */
export function buildLogoPrompt(args: {
  businessName: string;
  industry?: string | null;
  styleHint?: string | null;
  colors?: string | null;
  slogan?: string | null;
  iconIdea?: string | null;
  language?: string | null;
}): string {
  const parts: string[] = [
    `Logo design for "${args.businessName}".`,
    args.industry ? `Industry: ${args.industry}.` : "",
    args.styleHint ? `Style: ${args.styleHint}.` : "",
    args.colors ? `Color palette preference: ${args.colors}.` : "",
    args.iconIdea ? `Icon idea: ${args.iconIdea}.` : "",
    args.slogan ? `Tagline: "${args.slogan}".` : "",
    args.language ? `Wordmark language: ${args.language}.` : "",
    "Vector flat design, clean, modern, scalable, transparent or solid background.",
    "Centered composition, high contrast, suitable for social media avatar and end card.",
    "Avoid photorealism, no people faces, no copyrighted characters, no clutter.",
    "Output a single clear logo on solid background.",
  ];
  return parts.filter(Boolean).join(" ");
}
