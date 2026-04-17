import Link from "next/link";
import { Logo } from "@/components/ui/logo";

function LegalArticle() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-zinc-300">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">Legal</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated: April 14, 2026</p>
      </header>

      <p className="text-zinc-200">
        This Privacy Policy applies to our website Aivora (https://reelforge-delta.vercel.app)
        and describes how we collect, use, and protect your information when you use our service.
      </p>

      <Section title="1. Information We Collect">
        <p>When you use Aivora, we may collect the following information:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong className="text-foreground">Account Data:</strong> Email address and name you provide during registration.</li>
          <li><strong className="text-foreground">Content Data:</strong> Keywords and product images you input, and AI-generated content (scripts, captions, video prompts, videos) are stored to provide the Service.</li>
        </ul>
      </Section>

      <Section title="2. How We Use Your Information">
        <p>We use collected information solely to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Generate AI content and videos based on your input</li>
          <li>Store your generated assets so you can revisit and download them</li>
          <li>Improve Aivora and its features</li>
        </ul>
      </Section>

      <Section title="3. Data Sharing">
        <p>
          We do not sell your personal information. We share data only with the third-party services
          necessary to provide Aivora (OpenAI for content generation, video generation providers, and Vercel Blob for media storage).
        </p>
      </Section>

      <Section title="4. Data Storage and Security">
        <p>
          Your data is stored securely using industry-standard practices. Media assets are stored in
          encrypted cloud storage. We never store your payment credentials directly.
        </p>
      </Section>

      <Section title="5. Your Rights">
        <p>You can:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Delete your projects and associated media at any time from the application</li>
          <li>Request deletion of your account and all associated data by contacting us</li>
        </ul>
      </Section>

      <Section title="6. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. We will notify you of any material changes
          by updating the date at the top of this page.
        </p>
      </Section>

      <Section title="7. Contact">
        <p>
          For privacy-related questions or data deletion requests, please contact us at support@aivora.app
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

export default function PrivacyPage() {
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
