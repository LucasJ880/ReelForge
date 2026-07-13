import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import Link from "next/link";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const copy = getPlatformCopy(await getServerLocale()).auth;
  return (
    <div className="auth-studio-theme studio-canvas relative min-h-screen bg-background text-foreground">
      <div className="auth-grid pointer-events-none absolute inset-0" aria-hidden />
      <header className="relative z-10 flex h-[72px] items-center justify-between border-b border-border bg-card/95 px-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Aivora home"
        >
          <Logo size={40} />
          <span>
            <span className="block font-heading text-subhead font-semibold">Aivora</span>
            <span className="block text-meta text-muted-foreground">
              {copy.studio}
            </span>
          </span>
        </Link>
        <LanguageSwitcher variant="inline" className="w-auto min-w-32" />
      </header>
      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-7.5rem)] w-full max-w-7xl items-center gap-12 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.72fr)] lg:px-12">
        <section className="max-w-3xl space-y-7">
          <p className="studio-label text-muted-foreground">{copy.kicker}</p>
          <h1 className="font-heading text-[clamp(2.75rem,6vw,5.5rem)] font-semibold leading-[0.96] tracking-[-0.05em]">
            {copy.titleLead}<br /><span className="text-primary">{copy.titleAccent}</span>
          </h1>
          <p className="max-w-2xl text-subhead leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          <dl className="grid grid-cols-3 gap-2 border-t border-border pt-6 sm:gap-4">
            <div className="border-l border-border pl-3"><dt className="studio-label text-muted-foreground">{copy.workflow}</dt><dd className="mt-2 font-mono text-subhead font-semibold">1 → 4</dd></div>
            <div className="border-l border-border pl-3"><dt className="studio-label text-muted-foreground">{copy.trace}</dt><dd className="mt-2 font-mono text-subhead font-semibold">JOB ID</dd></div>
            <div className="border-l border-border pl-3"><dt className="studio-label text-muted-foreground">{copy.output}</dt><dd className="mt-2 font-mono text-subhead font-semibold">9:16</dd></div>
          </dl>
        </section>
        <Card className="studio-panel w-full min-w-0">{children}</Card>
      </main>
      <footer className="relative z-10 flex min-h-12 items-center justify-center gap-5 border-t border-border px-4 text-meta text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">{copy.privacy}</Link>
        <Link href="/terms" className="hover:text-foreground">{copy.terms}</Link>
      </footer>
    </div>
  );
}
