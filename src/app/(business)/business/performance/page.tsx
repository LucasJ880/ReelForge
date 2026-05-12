import { ComingSoonHero } from "@/components/coming-soon-hero";

export default function PerformancePage() {
  return (
    <ComingSoonHero
      eyebrow="Phase 2"
      title="Performance"
      subtitle="Tie every creative decision to actual platform performance."
      bullets={[
        "Per-video ROAS, view-through, retention curves",
        "Filter by product, angle, hook style, brand ending",
        "Auto-detect winning patterns and surface them in Creative Studio",
      ]}
    />
  );
}
