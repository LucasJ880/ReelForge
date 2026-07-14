import type { Metadata } from "next";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { getPublicPageCopy } from "@/i18n/public-copy";
import { getServerLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return getPublicPageCopy(locale).privacy.metadata;
}

export default async function PrivacyPage() {
  const locale = await getServerLocale();
  const copy = getPublicPageCopy(locale).privacy;
  const contact = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? "privacy@aivora.ai";

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-12 text-body sm:py-16">
      <header className="space-y-3 border-b border-border pb-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="studio-label text-primary">{copy.kicker}</p>
          <LanguageSwitcher variant="inline" className="w-auto min-w-32 shrink-0" />
        </div>
        <h1 className="editorial-display">{copy.title}</h1>
        <p className="text-muted-foreground">{copy.intro}</p>
      </header>

      {[copy.information, copy.purpose, copy.processors].map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="font-heading text-title font-semibold">{section.title}</h2>
          <p>{section.body}</p>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="font-heading text-title font-semibold">{copy.retention.title}</h2>
        <p>
          {copy.retention.beforeContact}{" "}
          <a className="text-primary underline" href={`mailto:${contact}`}>
            {contact}
          </a>
          {locale === "zh-CN" ? "，" : ". "}
          {copy.retention.afterContact}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-title font-semibold">{copy.security.title}</h2>
        <p>{copy.security.body}</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-title font-semibold">{copy.contactTitle}</h2>
        <p>
          {copy.contactLead}{" "}
          <a className="text-primary underline" href={`mailto:${contact}`}>
            {contact}
          </a>
          {locale === "zh-CN" ? "。" : "."}
        </p>
      </section>

      {!process.env.NEXT_PUBLIC_PRIVACY_EMAIL ? (
        <p className="rounded-(--radius-md) border border-warning bg-card p-4 text-meta">
          <strong>{copy.assumptionLabel}</strong> {copy.assumption}
        </p>
      ) : null}

      <p className="border-t border-border pt-6 text-muted-foreground">
        <Link href="/terms" className="text-primary underline">
          {copy.termsLink}
        </Link>{" "}
        ·{" "}
        <Link href="/login" className="text-primary underline">
          {copy.signInLink}
        </Link>
      </p>
    </main>
  );
}
