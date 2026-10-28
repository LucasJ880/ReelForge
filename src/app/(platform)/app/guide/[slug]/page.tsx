import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Lightbulb } from "lucide-react";
import { getServerLocale } from "@/i18n/server";
import { contactEmail } from "@/lib/config/contact";
import { GUIDE_PAGE_COPY, guideArticle, guideArticles } from "@/lib/guide/guide-articles";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = await getServerLocale();
  const article = guideArticle((await params).slug, locale);
  return article ? { title: `${article.title} · Aivora`, description: article.summary } : {};
}

/** 使用指南单篇：分节步骤 + 小贴士 + 直达对应页面的主行动 + 下一篇。 */
export default async function GuideArticlePage({ params }: Params) {
  const locale = await getServerLocale();
  const copy = GUIDE_PAGE_COPY[locale];
  const { slug } = await params;
  const article = guideArticle(slug, locale);
  if (!article) notFound();
  const all = guideArticles(locale);
  const next = all[(all.findIndex((item) => item.slug === article.slug) + 1) % all.length];

  return (
    <article className="studio-page mx-auto w-full max-w-3xl" data-testid="guide-article">
      <Link href="/app/guide" prefetch={false} className="inline-flex items-center gap-1.5 self-start text-meta text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {copy.back}
      </Link>

      <header className="space-y-4">
        <h1 className="studio-title">{article.title}</h1>
        <p className="studio-subtitle">{article.summary}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-meta text-tertiary">
          <span className="tabular-nums">{copy.minutes.replace("{n}", String(article.minutes))}</span>
          <span aria-hidden>·</span>
          <span>{copy.features}</span>
          {article.features.map((feature) => (
            <span key={feature} className="studio-chip">
              {feature}
            </span>
          ))}
        </p>
      </header>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={article.cover} alt="" className="aspect-video w-full rounded-(--radius-card) border border-border object-cover" />

      <div className="space-y-8">
        {article.sections.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2 className="studio-section-title">{section.heading}</h2>
            {section.body ? <p className="text-body leading-relaxed text-muted-foreground">{section.body}</p> : null}
            {section.steps ? (
              <ol className="space-y-2.5">
                {section.steps.map((step, index) => (
                  <li key={step} className="flex items-baseline gap-3 text-body leading-relaxed text-muted-foreground">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-meta tabular-nums text-foreground">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {section.tip ? (
              <p className="flex gap-2.5 rounded-(--radius-tile) border border-border bg-raised p-4 text-meta leading-relaxed text-muted-foreground">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
                <span>{section.tip}</span>
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href={article.href} prefetch={false} className="studio-cta">
          {article.cta}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      {next && next.slug !== article.slug ? (
        <Link href={`/app/guide/${next.slug}`} prefetch={false} className="studio-card flex items-center gap-4 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={next.cover} alt="" loading="lazy" className="aspect-video w-32 shrink-0 rounded-(--radius-tile) object-cover" />
          <span className="min-w-0 flex-1">
            <span className="block text-meta text-tertiary">{copy.next}</span>
            <span className="block truncate text-body font-semibold">{next.title}</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ) : null}

      <p className="text-meta text-tertiary">{copy.contact.replace("{email}", contactEmail())}</p>
    </article>
  );
}
