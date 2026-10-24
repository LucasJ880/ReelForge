import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { MonoTag } from "@/components/exchange/mono-tag";
import { WallVideo } from "@/components/exchange/wall-controls";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import {
  SHOWCASE_SAFE_SLUGS,
  hasVerifiedTemplateVideo,
  verifiedTemplateSample,
  verifiedTemplateVideo,
} from "@/lib/video-generation/template-sample";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import Link from "next/link";

/** 登录门上墙的样片：统一取公开面零瑕疵名单（template-sample.ts）。 */
const GATE_SAMPLES: readonly string[] = SHOWCASE_SAFE_SLUGS;

/**
 * 模板读数与样片：只读公开的模板库。登录页不能因为它挂掉——
 * 取数失败或超过 1.5 秒就整块不显示，登录表单照常可用。
 */
async function loadGateSamples(english: boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const templates = await Promise.race([
      listActiveStyleTemplates(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("gate samples timeout")), 1500);
      }),
    ]);
    const frames = GATE_SAMPLES.flatMap((slug) => {
      const template = templates.find((item) => item.slug === slug);
      const video = template ? verifiedTemplateVideo(slug, `/template-previews/${slug}.mp4`) : null;
      if (!template || !video) return [];
      return [{
        slug,
        name: english ? template.name : template.nameZh,
        video,
        poster: verifiedTemplateSample(slug, template.coverImage) ?? undefined,
      }];
    });
    return {
      templateCount: templates.length,
      sampleCount: templates.filter((template) => hasVerifiedTemplateVideo(template.slug)).length,
      frames,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 登录门：交易大厅开盘前的那一屏。左边是大而轻的宣言（信号青只给宣言的后半句）
 * 和一排真机模板样片（标明是样例，不冒充用户数据）；右边是带角标的登录终端。
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getServerLocale();
  const copy = getPlatformCopy(locale).auth;
  const samples = await loadGateSamples(locale === "en-US");
  return (
    <div className="gate-theme desk-canvas relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="x-pane relative z-10 flex h-16 items-center justify-between border-b px-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Aivora home"
        >
          <Logo size={36} />
          <span className="flex flex-col">
            <span className="font-heading text-[15px] font-semibold tracking-[0.14em]">AIVORA</span>
            <span className="font-mono text-micro uppercase tracking-wider text-muted-foreground">{copy.studio}</span>
          </span>
        </Link>
        <LanguageSwitcher variant="inline" className="w-auto min-w-32" />
      </header>
      <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-12 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)] lg:gap-16 lg:px-12">
        <section className="min-w-0 space-y-8">
          <h1 className="x-display text-[clamp(2.5rem,5.4vw,5.25rem)]">
            {copy.titleLead}
            <br />
            <span className="text-accent">{copy.titleAccent}</span>
          </h1>
          <p className="max-w-[46ch] text-body leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          {samples && samples.frames.length > 0 ? (
            <figure className="max-w-2xl space-y-2.5">
              <ul aria-label={copy.samples} className="x-wall x-frame grid-cols-3">
                {samples.frames.map((frame) => (
                  <li key={frame.slug} className="min-w-0">
                    <div className="relative aspect-video overflow-hidden bg-sunken">
                      <WallVideo src={frame.video} poster={frame.poster} label={frame.name} />
                      <div className="pointer-events-none absolute inset-0 bg-(image:--scrim)" aria-hidden />
                      <span className="absolute left-1.5 top-1.5 hidden rounded-(--radius-sm) bg-sunken/85 px-1.5 py-0.5 sm:block">
                        <MonoTag className="border-0 px-0 py-0">{copy.sampleTag}</MonoTag>
                      </span>
                    </div>
                    <p className="truncate px-3 py-2 text-meta text-muted-foreground">{frame.name}</p>
                  </li>
                ))}
              </ul>
              <figcaption className="font-mono text-data tabular-nums text-tertiary">
                {copy.counts
                  .replace("{templates}", String(samples.templateCount))
                  .replace("{samples}", String(samples.sampleCount))}
                {" · "}
                {copy.sampleNote}
              </figcaption>
            </figure>
          ) : null}
        </section>
        <Card className="x-frame w-full min-w-0">{children}</Card>
      </main>
      <footer className="x-pane relative z-10 flex min-h-12 items-center justify-center gap-5 border-t px-4 text-meta text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">{copy.privacy}</Link>
        <Link href="/terms" className="hover:text-foreground">{copy.terms}</Link>
      </footer>
    </div>
  );
}
