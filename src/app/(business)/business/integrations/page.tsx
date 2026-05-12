import { ComingSoonHero } from "@/components/coming-soon-hero";

export default function IntegrationsPage() {
  return (
    <ComingSoonHero
      eyebrow="Phase 2"
      title="Integrations"
      subtitle="Connect your platforms so Aivora can pull performance data and recommend the next video."
      bullets={[
        "TikTok Ads, Shopify, Meta — one-click connect",
        "Auto-import product catalogs and creative assets",
        "Sync ROAS & view-through data back into Creative Studio",
      ]}
    />
  );
}
