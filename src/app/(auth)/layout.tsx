import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { HeroReel } from "@/components/landing/hero-reel";
import { PilotCta } from "@/components/auth/pilot-cta";
import { LANDING_HERO_SCENES } from "@/lib/config/landing-media";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import Link from "next/link";

/**
 * 登录门（2026-10-28 与首页「展厅」同一语言，学 Seedance 2.5 官网 + LibTV）：
 * 左半屏是首页同一组全屏静音视频轮播（AI 生成的电影感商品广告镜头，标 AI 合规标签，不冒充客户实拍），
 * 口号压在视频底部；右半屏是中性底上的登录卡片，提交钮是这一屏唯一的实心钮，「申请试点」描边。
 * 窄屏只留表单。不再读模板库计数（登录页不查库）。
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getServerLocale();
  const copy = getPlatformCopy(locale).auth;
  const landing = getGrowthCopy(locale).landing;
  const scenes = LANDING_HERO_SCENES.map((scene) => ({
    video: scene.video,
    poster: scene.poster,
    label: `${landing.showroom.sceneLabel} · ${landing.heroScenes[scene.scene]}`,
  }));
  return (
    <div className="gate-theme relative grid min-h-screen bg-background text-foreground lg:grid-cols-[minmax(0,1.15fr)_minmax(440px,0.85fr)]">
      <section className="show-hero on-media hidden h-auto min-h-screen lg:block" aria-label={copy.studio}>
        <HeroReel scenes={scenes} sceneLabel={landing.showroom.sceneLabel} />
        <div className="absolute inset-x-0 bottom-0 z-[2] space-y-4 px-12 pb-14">
          <AiGeneratedLabel compact />
          <h1 className="show-gate-title">
            {copy.titleLead}
            <br />
            {copy.titleAccent.map((part, index) => (
              /* 英文段与段之间留一个可断行的空格；中文直接相接 */
              <span key={part}>
                {index > 0 && locale === "en-US" ? " " : null}
                <span className="inline-block">{part}</span>
              </span>
            ))}
          </h1>
          <p className="show-lead">{copy.subtitle}</p>
        </div>
      </section>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between px-4 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label="Aivora home"
          >
            <Logo size={30} />
            <span className="show-wordmark">AIVORA</span>
          </Link>
          <LanguageSwitcher variant="inline" className="w-auto min-w-32" />
        </header>
        <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-md space-y-6">
            <Card className="w-full min-w-0">{children}</Card>
            <PilotCta label={copy.pilotCta} hint={copy.pilotHint} />
          </div>
        </main>
        <footer className="flex min-h-12 items-center justify-center gap-5 px-4 text-meta text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">{copy.privacy}</Link>
          <Link href="/terms" className="hover:text-foreground">{copy.terms}</Link>
        </footer>
      </div>
    </div>
  );
}
