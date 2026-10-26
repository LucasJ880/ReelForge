import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { WallVideo } from "@/components/exchange/wall-controls";
import { PilotCta } from "@/components/auth/pilot-cta";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import { hasVerifiedTemplateVideo } from "@/lib/video-generation/template-sample";
import { LANDING_HERO_SCENES } from "@/lib/config/landing-media";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import Link from "next/link";

/** 登录门上墙的画面：与公开首页同一组上门服务场景（AI 生成，标 AI 合规标签），不再放电商样片。 */
const GATE_SCENES = LANDING_HERO_SCENES.filter((item) => item.scene !== "kitchen");

/**
 * 模板库读数：只读公开的模板库。登录页不能因为它挂掉——
 * 取数失败或超过 1.5 秒就不显示计数，画面与登录表单照常可用。
 */
async function loadGateCounts() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const templates = await Promise.race([
      listActiveStyleTemplates(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("gate counts timeout")), 1500);
      }),
    ]);
    return {
      templateCount: templates.length,
      sampleCount: templates.filter((template) => hasVerifiedTemplateVideo(template.slug)).length,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 登录门：交易大厅开盘前的那一屏。左边是大而轻的宣言（信号青只给宣言的后半句，
 * 与公开首页同一个定位：批量出片、找到带来询盘的那一条，不再承诺「赛出赢家」）、
 * 描边的「申请试点」和一排上门服务场景（AI 生成、标 AI 合规标签，不冒充客户实拍）；
 * 右边是带角标的登录终端，它的提交钮是这一屏唯一的实心钮。
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getServerLocale();
  const copy = getPlatformCopy(locale).auth;
  const landing = getGrowthCopy(locale).landing;
  const counts = await loadGateCounts();
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
            <span className="text-accent">
              {copy.titleAccent.map((part, index) => (
                /* 英文段与段之间留一个可断行的空格；中文直接相接 */
                <span key={part}>
                  {index > 0 && locale === "en-US" ? " " : null}
                  <span className="inline-block">{part}</span>
                </span>
              ))}
            </span>
          </h1>
          <p className="max-w-[46ch] text-body leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          <PilotCta label={copy.pilotCta} hint={copy.pilotHint} />
          <figure className="max-w-2xl space-y-2.5">
            <ul aria-label={landing.heroWallLabel} className="x-wall x-frame grid-cols-3">
              {GATE_SCENES.map((item) => (
                <li key={item.scene} className="min-w-0">
                  <div className="relative aspect-video overflow-hidden bg-sunken">
                    <WallVideo src={item.video} poster={item.poster} label={landing.heroScenes[item.scene]} />
                    <div className="pointer-events-none absolute inset-0 bg-(image:--scrim)" aria-hidden />
                    <span className="absolute left-1.5 top-1.5 hidden sm:block">
                      <AiGeneratedLabel compact />
                    </span>
                  </div>
                  <p className="truncate px-3 py-2 text-meta text-muted-foreground">{landing.heroScenes[item.scene]}</p>
                </li>
              ))}
            </ul>
            <figcaption className="font-mono text-data tabular-nums text-tertiary">
              {counts
                ? `${copy.counts
                    .replace("{templates}", String(counts.templateCount))
                    .replace("{samples}", String(counts.sampleCount))} · `
                : null}
              {landing.heroNote}
            </figcaption>
          </figure>
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
