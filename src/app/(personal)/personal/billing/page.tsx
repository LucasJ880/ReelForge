import { ComingSoonHero } from "@/components/coming-soon-hero";

export default function BillingPage() {
  return (
    <ComingSoonHero
      eyebrow="Phase 2"
      title="Billing"
      subtitle="Subscriptions and credits for personal creators, coming soon."
      bullets={[
        "Free monthly credits",
        "Pay-as-you-go credits for longer videos",
        "Manage usage and download invoices",
      ]}
    />
  );
}
