import Link from "next/link";
import { Logo } from "@/components/ui/logo";

function LegalArticle() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-zinc-300">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">Legal</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Terms of Service</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated: April 14, 2026</p>
      </header>

      <p className="text-zinc-200">
        These Terms of Service govern your use of the website Aivora (https://reelforge-delta.vercel.app).
        Please read these terms carefully before using our service.
      </p>

      <Section title="1. Acceptance of Terms">
        <p>
          By accessing and using Aivora (&quot;the Service&quot;), you agree to be bound by these Terms of Service.
          If you do not agree, please do not use the Service.
        </p>
      </Section>

      <Section title="2. Description of Service">
        <p>
          Aivora is an AI-powered short video creation platform that helps users generate short-form video
          content from keywords and product information. Generated videos can be downloaded as mp4 files
          for self-publishing to the platforms of your choice.
        </p>
      </Section>

      <Section title="3. User Accounts">
        <p>
          You must create an account to use Aivora. You are responsible for maintaining the security of
          your account credentials and for all activities that occur through your account.
        </p>
      </Section>

      <Section title="4. Content and Intellectual Property">
        <p>
          Content generated through Aivora using AI tools is provided as-is. You retain ownership of
          the keywords and creative direction you provide. You are responsible for ensuring that content
          you download and publish elsewhere complies with the terms of service of the destination platforms.
        </p>
      </Section>

      <Section title="5. Third-Party Services">
        <p>
          Aivora integrates with third-party APIs including OpenAI and video generation services.
          Your use of these services through Aivora is also subject to their respective terms and policies.
        </p>
      </Section>

      <Section title="6. Prohibited Uses">
        <p>You agree not to use Aivora to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Generate or distribute illegal, harmful, or misleading content</li>
          <li>Violate any applicable laws or regulations</li>
          <li>Infringe on the intellectual property rights of others</li>
          <li>Attempt to access other users&apos; accounts or data</li>
        </ul>
      </Section>

      <Section title="7. Limitation of Liability">
        <p>
          Aivora is provided &quot;as is&quot; without warranties of any kind. We are not liable for any
          damages arising from your use of the Service, including but not limited to content moderation actions
          taken by third-party platforms.
        </p>
      </Section>

      <Section title="8. Changes to Terms">
        <p>
          We reserve the right to modify these terms at any time. Continued use of Aivora after changes
          constitutes acceptance of the updated terms.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          For questions about these terms, please contact us at support@aivora.app
          or through the Aivora platform.
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={24} />
            <span className="text-sm font-semibold tracking-tight">Aivora</span>
          </Link>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← 回到首页
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <LegalArticle />
      </main>
    </div>
  );
}
