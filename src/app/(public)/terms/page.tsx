import type { Metadata } from "next";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { MonoTag } from "@/components/exchange/mono-tag";
import { getPublicPageCopy } from "@/i18n/public-copy";
import { getServerLocale } from "@/i18n/server";
import { contactEmail } from "@/lib/config/contact";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return getPublicPageCopy(locale).terms.metadata;
}

export default async function TermsPage() {
  const locale = await getServerLocale();
  const copy = getPublicPageCopy(locale).terms;
  const contact = contactEmail();
  const sections = [
    copy.usage,
    copy.inputs,
    copy.output,
    copy.prohibited,
    copy.plans,
    copy.liability,
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-12 text-body sm:py-16">
      <header className="space-y-3 border-b border-border pb-7">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h1 className="x-display">{copy.title}</h1>
          <LanguageSwitcher variant="inline" className="w-auto min-w-32 shrink-0" />
        </div>
        <MonoTag className="self-start">{copy.draftStatus}</MonoTag>
        <p className="text-muted-foreground">{copy.intro}</p>
      </header>

      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="font-heading text-title font-semibold">{section.title}</h2>
          <p>{section.body}</p>
        </section>
      ))}

      <p className="border-t border-border pt-6 text-muted-foreground">
        {copy.questions}{" "}
        <a className="text-primary underline" href={`mailto:${contact}`}>
          {contact}
        </a>{" "}
        ·{" "}
        <Link href="/privacy" className="text-primary underline">
          {copy.privacyLink}
        </Link>{" "}
        ·{" "}
        <Link href="/login" className="text-primary underline">
          {copy.signInLink}
        </Link>
      </p>
    </main>
  );
}
