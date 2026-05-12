import { ComingSoonHero } from "@/components/coming-soon-hero";

export default function CreativeStudioPage() {
  return (
    <ComingSoonHero
      eyebrow="Phase 2"
      title="Creative Studio"
      subtitle="Side-by-side angle variants, A/B prompt tuning, and performance-aware rewrites."
      bullets={[
        "Compare two prompts on the same product, generate together",
        "Pull winning angles from your highest-ROAS videos",
        "Refine brand voice and ending modes per campaign",
      ]}
    />
  );
}
