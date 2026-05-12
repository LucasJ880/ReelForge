import { ComingSoonHero } from "@/components/coming-soon-hero";

export default function RecommendationsPage() {
  return (
    <ComingSoonHero
      eyebrow="Phase 2"
      title="Recommendations"
      subtitle="Aivora reads your performance data and recommends the next video."
      bullets={[
        "Suggest hook variants based on winning openings",
        "Recommend brand ending tweaks per audience segment",
        "One-click queue: send recommended brief into Create Ad Video",
      ]}
    />
  );
}
