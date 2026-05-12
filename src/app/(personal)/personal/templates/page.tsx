import { ComingSoonHero } from "@/components/coming-soon-hero";

export default function TemplatesPage() {
  return (
    <ComingSoonHero
      eyebrow="Phase 2"
      title="Templates"
      subtitle="Start from a curated style or remix a community template."
      bullets={[
        "Cinematic, vlog, ASMR, fashion, food — preset starters",
        "Save your own prompts as personal templates",
        "Share templates with friends",
      ]}
    />
  );
}
