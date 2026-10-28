import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getServerLocale } from "@/i18n/server";
import { GUIDE_PAGE_COPY, guideArticles, type GuideArticle } from "@/lib/guide/guide-articles";

export async function generateMetadata(): Promise<Metadata> {
  const copy = GUIDE_PAGE_COPY[await getServerLocale()];
  return { title: `${copy.title} · Aivora`, description: copy.subtitle };
}

/**
 * 使用指南首页（2026-10-28，CEO 要的 user guide；学 LibTV「学院」）：
 * 一张「从这里开始」主卡 + 全部教程卡片墙，每张卡写阅读时长与涉及功能。
 */
export default async function GuidePage() {
  const locale = await getServerLocale();
  const copy = GUIDE_PAGE_COPY[locale];
  const [featured, ...rest] = guideArticles(locale);

  return (
    <div className="studio-page" data-testid="guide-page">
      <header className="studio-head">
        <div className="min-w-0">
          <h1 className="studio-title">{copy.title}</h1>
          <p className="studio-subtitle">{copy.subtitle}</p>
        </div>
      </header>

      {featured ? (
        <Link
          href={`/app/guide/${featured.slug}`}
          prefetch={false}
          className="studio-card grid gap-0 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
        >
          <span className="relative block aspect-video overflow-hidden bg-sunken">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={featured.cover} alt="" className="absolute inset-0 size-full object-cover" />
          </span>
          <div className="flex min-w-0 flex-col gap-4 p-6 md:p-8">
            <span className="studio-chip self-start">{copy.featured}</span>
            <h2 className="text-title font-semibold leading-snug">{featured.title}</h2>
            <p className="text-body leading-relaxed text-muted-foreground">{featured.summary}</p>
            <ArticleMeta article={featured} copy={copy} />
            <span className="studio-cta mt-auto self-start">
              {copy.read}
              <ArrowRight className="size-4" aria-hidden />
            </span>
          </div>
        </Link>
      ) : null}

      <section aria-labelledby="guide-all" className="space-y-4">
        <h2 id="guide-all" className="studio-section-title">
          {copy.all}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rest.map((article) => (
            <li key={article.slug} className="min-w-0">
              <Link href={`/app/guide/${article.slug}`} prefetch={false} className="studio-card flex h-full flex-col">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={article.cover} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
                  <h3 className="text-subhead font-semibold leading-snug">{article.title}</h3>
                  <p className="line-clamp-2 text-meta leading-relaxed text-muted-foreground">{article.summary}</p>
                  <ArticleMeta article={article} copy={copy} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ArticleMeta({ article, copy }: { article: GuideArticle; copy: (typeof GUIDE_PAGE_COPY)["zh-CN"] }) {
  return (
    <div className="mt-auto space-y-2">
      <p className="text-meta tabular-nums text-tertiary">{copy.minutes.replace("{n}", String(article.minutes))}</p>
      <p className="flex flex-wrap items-center gap-1.5 text-meta text-tertiary">
        <span>{copy.features}</span>
        {article.features.map((feature) => (
          <span key={feature} className="studio-chip">
            {feature}
          </span>
        ))}
      </p>
    </div>
  );
}
