import Link from "next/link";

export const metadata = { title: "Privacy Policy Draft · Aivora" };

export default function PrivacyPage() {
  const contact = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? "privacy@aivora.ai";
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-12 text-body sm:py-16">
      <header className="space-y-3 border-b border-border pb-7">
        <p className="studio-label text-primary">DRAFT · PENDING CANADIAN LEGAL REVIEW</p>
        <h1 className="editorial-display">Privacy Policy</h1>
        <p className="text-muted-foreground">Engineering draft for Aivora, operated from Ontario, Canada. Last updated July 13, 2026.</p>
      </header>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Information we handle</h2><p>We process account and workspace details, product images and videos you upload, prompts and creative instructions, generated media, job and quality records, usage and cost events, and technical logs needed to secure and operate the service.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Why we use it</h2><p>We use this information to authenticate users, create and quality-check videos, deliver and troubleshoot batches, prevent abuse, measure plan usage, support customers, and improve service reliability. We do not sell customer media or prompts.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Processors and data routes</h2><p>Current infrastructure may include Neon for North American database hosting, Vercel and its IAD1 Blob store for application and object hosting, OpenAI for configured language, product-image generation and editing, vision, and moderation tasks, and BytePlus international endpoints for configured Seedance video generation. Buddy will be added here only after its processing location and contract are confirmed and the provider is enabled.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Retention and deletion</h2><p>Records are retained only for the operating, contractual, security, and audit purposes described above. Exact customer retention periods remain a launch configuration decision and will be stated in the lawyer-reviewed version. You may request access, correction, export, or deletion by emailing <a className="text-primary underline" href={`mailto:${contact}`}>{contact}</a>. We will verify identity and explain any records that must be retained for legal or security reasons.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Security and international processing</h2><p>Production secrets are kept outside source control, access is role-limited, and generation activity is logged for traceability. Data may be processed in Canada, the United States, or another disclosed provider region under contractual safeguards.</p></section>
      <section className="space-y-3"><h2 className="font-heading text-title font-semibold">Contact</h2><p>Questions or privacy requests: <a className="text-primary underline" href={`mailto:${contact}`}>{contact}</a>.</p></section>
      {!process.env.NEXT_PUBLIC_PRIVACY_EMAIL ? <p className="rounded-(--radius-md) border border-warning bg-card p-4 text-meta"><strong>ASSUMPTION:</strong> privacy@aivora.ai is the draft contact address. Human operations must confirm that this mailbox is monitored or configure NEXT_PUBLIC_PRIVACY_EMAIL before customer launch.</p> : null}
      <p className="border-t border-border pt-6 text-muted-foreground"><Link href="/terms" className="text-primary underline">Read the Terms of Service</Link> · <Link href="/login" className="text-primary underline">Return to sign in</Link></p>
    </main>
  );
}
