import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadCaptureForm, LeadLocaleToggle } from "@/components/leads/lead-capture-form";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "@/i18n/config";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { getPublicLeadPage as loadPublicLeadPage, type PublicLeadPage } from "@/lib/services/lead-service";
import { TRACKED_LINK_CODE_RE } from "@/lib/services/tracked-link-service";

export const dynamic = "force-dynamic";

/// generateMetadata 与页面同一次请求只查一次库
const getPublicLeadPage = cache(loadPublicLeadPage);

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * 询盘页语言：访客自己选过（cookie）为准 → 商家设的默认语言 → 浏览器语言 → 站点默认。
 */
async function resolveLocale(page: PublicLeadPage): Promise<Locale> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  if (page.config.locale) return page.config.locale;
  const accept = (await headers()).get("accept-language") ?? "";
  if (/^\s*en\b/i.test(accept)) return "en-US";
  if (/^\s*zh\b/i.test(accept)) return "zh-CN";
  return DEFAULT_LOCALE;
}

function single(value: string | string[] | undefined, max = 100): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublicLeadPage(slug);
  if (!page) return { title: "Not found", robots: { index: false } };
  const locale = await resolveLocale(page);
  const copy = getGrowthCopy(locale).leadPage;
  const business = page.businessName ?? copy.fallbackBusiness;
  return {
    title: `${business} · ${page.config.headline ?? copy.metaTitle}`,
    description: page.config.intro ?? copy.defaultIntro,
  };
}

/**
 * 商家询盘页 /l/[slug]（计划 6.2 / D4）：只对超管开通的工作区可见，其余一律 404。
 * 页面是商家的门面：标题、介绍、服务项、电话；Aivora 只在页脚署名。
 *
 * 刻意不放在 (public) 路由组里：那里的 loading.tsx 会让页面在 Suspense 里流式输出，
 * notFound() 时响应头已经发出，只能回 200 + 404 界面。放在根下才是真正的 HTTP 404。
 */
export default async function LeadPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const page = await getPublicLeadPage(slug);
  if (!page) notFound();
  const query = await searchParams;
  const locale = await resolveLocale(page);
  const growth = getGrowthCopy(locale);
  const copy = growth.leadPage;
  const business = page.businessName ?? copy.fallbackBusiness;
  const code = single(query.t, 32);
  const phone = page.config.phone ?? null;
  const services = page.config.services ?? [];

  return (
    <div className="gate-theme desk-canvas relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="x-pane relative z-10 flex h-14 items-center justify-between gap-3 border-b px-4 sm:px-8">
        <span className="min-w-0 truncate font-heading text-subhead font-medium">{page.businessName ?? ""}</span>
        <LeadLocaleToggle locale={locale} label={copy.switchLocale} />
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-start gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)] lg:gap-14 lg:py-16">
        <section className="min-w-0 space-y-6">
          <h1 className="x-display text-[clamp(2rem,4.4vw,3.75rem)]">{page.config.headline ?? copy.defaultHeadline}</h1>
          <p className="max-w-[52ch] text-body leading-relaxed text-muted-foreground">{page.config.intro ?? copy.defaultIntro}</p>
          {phone ? (
            <Button render={<a href={`tel:${phone.replace(/[^\d+]/g, "")}`} />} variant="outline" size="lg">
              <Phone aria-hidden />
              {copy.callUs} · <span className="font-mono tabular-nums">{phone}</span>
            </Button>
          ) : null}
          {services.length || page.config.region ? (
            <dl className="x-wall grid-cols-1 sm:grid-cols-2">
              {services.length ? (
                <div className="min-w-0 space-y-2 px-5 py-4">
                  <dt className="x-label">{copy.services}</dt>
                  <dd>
                    <ul className="flex flex-wrap gap-1.5">
                      {services.map((service) => (
                        <li key={service} className="rounded-(--radius-sm) border border-border px-2 py-0.5 text-meta">
                          {service}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {page.config.region ? (
                <div className="min-w-0 space-y-2 px-5 py-4">
                  <dt className="x-label">{copy.region}</dt>
                  <dd className="flex items-center gap-2 text-body">
                    <MapPin className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                    {page.config.region}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>

        <div className="x-panel x-frame min-w-0">
          <LeadCaptureForm
            locale={locale}
            slug={page.slug}
            business={business}
            services={services}
            phone={phone}
            trackedCode={code && TRACKED_LINK_CODE_RE.test(code) ? code : null}
            utm={{
              source: single(query.utm_source),
              medium: single(query.utm_medium),
              campaign: single(query.utm_campaign),
            }}
          />
        </div>
      </main>

      <footer className="x-pane relative z-10 flex min-h-12 flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t px-4 py-2 text-meta text-muted-foreground">
        <span>{copy.poweredBy}</span>
        <Link href="/privacy" className="hover:text-foreground">
          {copy.privacy}
        </Link>
      </footer>
    </div>
  );
}
