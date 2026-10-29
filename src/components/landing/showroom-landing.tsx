import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { PilotApplicationForm } from "@/components/leads/pilot-application-form";
import type { Locale } from "@/i18n/config";
import { getGrowthCopy } from "@/i18n/growth-copy";
import {
  LANDING_HERO_SCENES,
  LANDING_PROOF_VIDEOS,
  LANDING_STORYBOARD_FRAMES,
  SHOWROOM_PRODUCT_PAIRS,
} from "@/lib/config/landing-media";
import { HeroReel } from "./hero-reel";
import { ShowRail } from "./show-rail";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * 公开首页「展厅」（2026-10-28，学 Seedance 2.5 官网，见 docs/reference/taste/seed.bytedance.com.md）。
 *
 *  - 第一幕：全屏静音视频轮播（AI 生成的电影感商品广告镜头，必须标 AI 生成），文字只在底部：一个大标题、一句话、
 *    三个等宽玻璃胶囊（免费试做 → 注册 / 看样片 / 申请陪跑）。没有眉题、要点列表和读数。
 *  - 第二幕：浅灰画廊，每节一个标题 + 一句话 + 「输入 → 成片」横向轮播：商品图 → 样片、故事板四帧 → 成片、
 *    关联方 SunnyShutter 的真实投放。成片只取公开安全名单里的样片。
 *  - 第三幕：申请 30 天陪跑表单 + 页脚。
 * 界面是灰的，颜色只来自成片；毛玻璃只给压在视频上的控件（.on-media）。
 */
export function ShowroomLanding({ locale, fallbackEmail }: { locale: Locale; fallbackEmail: string | null }) {
  const copy = getGrowthCopy(locale).landing;
  const show = copy.showroom;
  const scenes = LANDING_HERO_SCENES.map((scene) => ({
    video: scene.video,
    poster: scene.poster,
    label: `${show.sceneLabel} · ${copy.heroScenes[scene.scene]}`,
  }));

  return (
    <div className="showroom min-h-screen">
      <section className="show-hero on-media" aria-label={show.heroTitle}>
        <HeroReel scenes={scenes} sceneLabel={show.sceneLabel} />

        <header className="show-nav">
          <Link
            href="/"
            aria-label={copy.home}
            className="flex min-w-0 items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--show-on-media)"
          >
            <Logo size={28} />
            <span className="show-wordmark">AIVORA</span>
          </Link>
          <nav aria-label={copy.home} className="hidden items-center gap-2 md:flex">
            <a href="#samples" className="show-nav-pill">
              {show.nav.samples}
            </a>
            <a href="#how" className="show-nav-pill">
              {show.nav.how}
            </a>
            <a href="#pilot-apply" className="show-nav-pill">
              {show.nav.apply}
            </a>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher
              variant="sidebar"
              className="show-nav-pill hidden h-8 w-auto gap-2 rounded-full px-3.5 text-(color:--show-on-media) hover:bg-(--show-nav-pill-hover) hover:text-(color:--show-on-media) sm:flex"
            />
            <Link href="/login" className="show-nav-pill">
              {copy.signIn}
            </Link>
          </div>
        </header>

        <div className="show-hero-copy">
          <div className="min-w-0">
            <AiGeneratedLabel compact className="mb-4" />
            <h1 className="show-title">{show.heroTitle}</h1>
            <p className="show-lead">{show.heroLead}</p>
          </div>
          <div className="show-cta-row">
            {/* 全页唯一实心主行动（LENS-10）：白色实心胶囊；另两个是视频上的玻璃胶囊 */}
            <Link href="/register" className="show-glass" data-primary="true">
              {copy.trial}
            </Link>
            <a href="#samples" className="show-glass">
              {show.ctaSamples}
            </a>
            <a href="#pilot-apply" className="show-glass">
              {copy.apply}
            </a>
          </div>
        </div>
      </section>

      <main className="show-canvas">
        <ShowRail id="samples" title={show.pairsTitle} body={show.pairsBody} prev={show.prev} next={show.next}>
          {SHOWROOM_PRODUCT_PAIRS.map((pair) => (
            <li key={pair.slug} className="show-card show-card-wide">
              <video
                className="show-card-media"
                src={pair.video}
                poster={pair.poster}
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={show.pairNames[pair.slug]}
              />
              <div className="show-card-scrim" aria-hidden />
              <div className="show-card-top">
                <div className="show-card-inputs">
                  <span className="show-chip">{show.inputChip}</span>
                  {pair.inputs.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="" loading="lazy" />
                  ))}
                </div>
                <span className="flex items-center gap-2">
                  <span className="show-chip">{show.outputChip}</span>
                  <AiGeneratedLabel compact />
                </span>
              </div>
              <p className="show-card-caption">{show.pairNames[pair.slug]}</p>
            </li>
          ))}
        </ShowRail>

        <ShowRail id="how" title={show.storyboardTitle} body={show.storyboardBody} prev={show.prev} next={show.next}>
          <li className="show-card show-card-wide">
            <div className="show-frames">
              {LANDING_STORYBOARD_FRAMES.map((url, index) => (
                <figure key={url} className="relative min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" loading="lazy" />
                  <figcaption className="show-chip absolute left-2 top-2 tabular-nums">{pad(index + 1)}</figcaption>
                </figure>
              ))}
            </div>
            <div className="show-card-top">
              <span className="show-chip">{show.storyboardChip}</span>
              <AiGeneratedLabel compact />
            </div>
          </li>
          {LANDING_PROOF_VIDEOS[1] ? (
            <li className="show-card show-card-tall">
              <video
                className="show-card-media"
                src={LANDING_PROOF_VIDEOS[1].video}
                poster={LANDING_PROOF_VIDEOS[1].poster}
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={copy.proofItems[1] ?? show.outputChip}
              />
              <div className="show-card-scrim" aria-hidden />
              <div className="show-card-top">
                <span className="show-chip">{show.outputChip}</span>
                <AiGeneratedLabel compact />
              </div>
            </li>
          ) : null}
        </ShowRail>

        <ShowRail id="delivered" title={show.deliveredTitle} body={show.deliveredBody} prev={show.prev} next={show.next}>
          {LANDING_PROOF_VIDEOS.map((item, index) => (
            <li key={item.video} className="show-card show-card-tall">
              <video
                className="show-card-media"
                src={item.video}
                poster={item.poster}
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={copy.proofItems[index] ?? show.deliveredTitle}
              />
              <div className="show-card-scrim" aria-hidden />
              <div className="show-card-top">
                <span className="show-chip">{show.deliveredChip}</span>
                <AiGeneratedLabel compact />
              </div>
              <p className="show-card-caption">{copy.proofItems[index]}</p>
            </li>
          ))}
        </ShowRail>
      </main>

      <section
        id="pilot-apply"
        aria-labelledby="pilot-apply-title"
        className="gate-theme mx-auto grid w-full max-w-6xl scroll-mt-8 gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(380px,1fr)] lg:gap-14 lg:py-28"
      >
        <div className="min-w-0 space-y-5">
          <h2 id="pilot-apply-title" className="show-section-title show-on-dark">
            {copy.applyTitle}
          </h2>
          <p className="show-lead">{copy.applyLead}</p>
          <ol className="space-y-3">
            {copy.applyNext.map((item, index) => (
              <li key={item} className="show-apply-step">
                <span className="tabular-nums">{pad(index + 1)}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="x-panel x-frame min-w-0">
          <PilotApplicationForm locale={locale} fallbackEmail={fallbackEmail} />
        </div>
      </section>

      <footer className="show-foot">
        <Link href="/privacy">
          {copy.privacy}
        </Link>
        <Link href="/terms">
          {copy.terms}
        </Link>
      </footer>
    </div>
  );
}
