import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { SectionHead } from "@/components/exchange/section-head";
import { MonoTag } from "@/components/exchange/mono-tag";
import { WallVideo } from "@/components/exchange/wall-controls";
import type { Locale } from "@/i18n/config";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { PilotApplicationForm } from "./pilot-application-form";

export type LandingSample = { slug: string; name: string; video: string; poster?: string };

/**
 * 公开首页（未登录访客）：讲清 30 天试点怎么走、规则是什么，然后一张申请表。
 * 不写价格、不写效果主张；样片只来自公开面零瑕疵名单，标「样例」并写明不是客户数据。
 */
export function PilotLanding({
  locale,
  samples,
  fallbackEmail,
}: {
  locale: Locale;
  samples: LandingSample[];
  fallbackEmail: string | null;
}) {
  const copy = getGrowthCopy(locale).landing;
  return (
    <div className="gate-theme desk-canvas relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="x-pane relative z-10 flex h-16 items-center justify-between gap-3 border-b px-4 sm:px-8">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={copy.home}
        >
          <Logo size={36} />
          <span className="font-heading text-[15px] font-semibold tracking-[0.14em]">AIVORA</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher variant="inline" className="hidden w-auto min-w-32 sm:flex" />
          <Button render={<Link href="/login" />} variant="outline">
            {copy.signIn}
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 space-y-16 px-4 py-12 sm:px-8 lg:px-12 lg:py-16">
        <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
          <div className="min-w-0 space-y-7">
            <h1 className="x-display text-[clamp(2.25rem,4.6vw,4.5rem)]">
              {copy.titleLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="max-w-[58ch] text-body leading-relaxed text-muted-foreground">{copy.subtitle}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button render={<a href="#pilot-apply" />} size="lg">
                {copy.apply}
                <ArrowRight aria-hidden />
              </Button>
              <LanguageSwitcher variant="inline" className="w-auto min-w-32 sm:hidden" />
            </div>
          </div>
          {samples.length > 0 ? (
            <figure className="min-w-0 space-y-2.5">
              <ul aria-label={copy.samples} className="x-wall x-frame grid-cols-2">
                {samples.map((sample, index) => (
                  <li key={sample.slug} className={index === 0 && samples.length % 2 === 1 ? "col-span-2 min-w-0" : "min-w-0"}>
                    <div className="relative aspect-video overflow-hidden bg-sunken">
                      <WallVideo src={sample.video} poster={sample.poster} label={sample.name} />
                      <div className="pointer-events-none absolute inset-0 bg-(image:--scrim)" aria-hidden />
                      <span className="absolute left-1.5 top-1.5 rounded-(--radius-sm) bg-sunken/85 px-1.5 py-0.5">
                        <MonoTag className="border-0 px-0 py-0">{copy.sampleTag}</MonoTag>
                      </span>
                    </div>
                    <p className="truncate px-3 py-2 text-meta text-muted-foreground">{sample.name}</p>
                  </li>
                ))}
              </ul>
              <figcaption className="font-mono text-data text-tertiary">{copy.sampleNote}</figcaption>
            </figure>
          ) : null}
        </section>

        <section aria-labelledby="pilot-structure" className="space-y-4">
          <SectionHead title={<span id="pilot-structure">{copy.structureTitle}</span>} hint={copy.structureHint} />
          <ol className="x-wall grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {copy.steps.map((step, index) => (
              <li key={step.title} className="flex min-w-0 flex-col gap-3 px-5 py-5">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-data tabular-nums text-accent">{String(index + 1).padStart(2, "0")}</span>
                  <span className="x-label">{step.when}</span>
                </span>
                <h3 className="text-subhead font-medium">{step.title}</h3>
                <p className="text-meta leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="pilot-rules" className="space-y-4">
          <SectionHead title={<span id="pilot-rules">{copy.rulesTitle}</span>} />
          <dl className="x-wall grid-cols-1 sm:grid-cols-2">
            {copy.rules.map((rule) => (
              <div key={rule.title} className="min-w-0 space-y-2 px-5 py-5">
                <dt className="text-body font-medium">{rule.title}</dt>
                <dd className="max-w-[56ch] text-meta leading-relaxed text-muted-foreground">{rule.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          id="pilot-apply"
          aria-labelledby="pilot-apply-title"
          className="grid scroll-mt-8 gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(380px,1fr)] lg:gap-14"
        >
          <div className="min-w-0 space-y-5">
            <h2 id="pilot-apply-title" className="text-section font-light leading-tight">
              {copy.applyTitle}
            </h2>
            <p className="max-w-[46ch] text-body leading-relaxed text-muted-foreground">{copy.applyLead}</p>
            <ol className="space-y-3">
              {copy.applyNext.map((item, index) => (
                <li key={item} className="flex items-baseline gap-3 text-meta text-muted-foreground">
                  <span className="font-mono text-data tabular-nums text-tertiary">{String(index + 1).padStart(2, "0")}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="x-panel x-frame min-w-0">
            <PilotApplicationForm locale={locale} fallbackEmail={fallbackEmail} />
          </div>
        </section>
      </main>

      <footer className="x-pane relative z-10 flex min-h-12 items-center justify-center gap-5 border-t px-4 text-meta text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">
          {copy.privacy}
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          {copy.terms}
        </Link>
      </footer>
    </div>
  );
}
