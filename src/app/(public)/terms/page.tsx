import Link from "next/link";

export const metadata = { title: "Terms of Service Draft · Aivora" };

export default function TermsPage() {
  const contact = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? "privacy@aivora.ai";
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-12 text-body sm:py-16">
      <header className="space-y-3 border-b border-border pb-7"><p className="studio-label text-primary">DRAFT · PENDING CANADIAN LEGAL REVIEW</p><h1 className="editorial-display">Terms of Service</h1><p className="text-muted-foreground">Engineering draft for business pilot review. Last updated July 13, 2026.</p></header>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Using Aivora</h2><p>You must provide accurate account information, protect your credentials, and use the service only for lawful business purposes. You remain responsible for reviewing generated media before publication and for disclosures required by the destination platform.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Your inputs and permissions</h2><p>You retain your rights in uploaded materials. You grant Aivora and disclosed processors the limited permission needed to process, store, generate, quality-check, and deliver your requested output. You confirm that you have the rights and consents required for all product media, people, brands, music, and instructions you submit.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">AI-generated output</h2><p>Images and videos are produced by probabilistic systems and can contain errors, altered product details, or similarities to other content. Aivora applies identity-preservation prompts, technical checks, and generation constraints, but does not guarantee factual, legal, platform, or brand suitability. Do not remove required AI disclosures. Human review remains required before customer publication.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Prohibited use</h2><p>Do not create illegal, deceptive, infringing, abusive, sexually exploitative, privacy-invasive, or impersonating content; bypass safety controls; upload malware; probe other customers’ data; or overload the service. We may pause generation, remove content, or suspend access to protect customers and the platform.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Plans, availability, and pilots</h2><p>Plan limits and any pilot fees are defined in the applicable order form or customer agreement. Providers and capacity may change. We may queue, stop, or reroute work to preserve safety and reliability. Self-serve payment is not part of the current B2B pilot.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Warranty and liability draft</h2><p>The service is provided subject to the warranties, liability limits, indemnities, governing law, and termination terms in the final lawyer-reviewed agreement. Those commercial clauses are intentionally not finalized in this engineering draft.</p></section>
      <p className="border-t border-border pt-6 text-muted-foreground">Questions: <a className="text-primary underline" href={`mailto:${contact}`}>{contact}</a> · <Link href="/privacy" className="text-primary underline">Privacy Policy</Link> · <Link href="/login" className="text-primary underline">Return to sign in</Link></p>
      {!process.env.NEXT_PUBLIC_PRIVACY_EMAIL ? <p className="rounded-(--radius-md) border border-warning bg-card p-4 text-meta"><strong>ASSUMPTION:</strong> privacy@aivora.ai is a draft contact only; human operations must confirm it before customer launch.</p> : null}
    </main>
  );
}
