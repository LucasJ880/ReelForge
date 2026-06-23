import Link from "next/link";
import { ArrowRight, PawPrint, Play, Sparkles } from "lucide-react";
import { PhoneVideoMockup } from "@/components/demo/phone-video-mockup";
import {
  PET_HERO_OPENING,
  PET_SAMPLE_VIDEO_POSTER,
  PET_SAMPLE_VIDEO_URL,
  PET_SLOGAN,
  PET_WALKTHROUGH_VIDEO_URL,
  heroStats,
  type HeroStat,
} from "@/lib/demo/pet-content-kit-demo-data";

interface PetHeroProps {
  ctaPrimaryHref: string;
  ctaPrimaryLabel: string;
}

export function PetHero({ ctaPrimaryHref, ctaPrimaryLabel }: PetHeroProps) {
  return (
    <section className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 pet-ambient-glow" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-5 pb-14 pt-10 sm:px-8 lg:flex-row lg:items-center lg:gap-12 lg:px-10 lg:pb-20 lg:pt-14">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--pet-orange)]/30 bg-[var(--pet-orange)]/10 px-3 py-1 text-xs font-medium text-[color:var(--pet-orange)]">
            <PawPrint size={14} />
            Aivora 宠物内容智能采集套件
          </div>
          <h1 className="mt-6 max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl sm:leading-[1.15] break-keep [line-break:strict]">
            把每一个真实宠物瞬间，
            <br className="hidden sm:inline" />
            变成<span className="text-[color:var(--pet-orange)]">可以马上分享</span>的可爱视频。
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
            {PET_HERO_OPENING}
          </p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-[var(--pet-teal)]/25 bg-[var(--pet-teal)]/8 px-4 py-2 text-sm font-medium text-[color:var(--pet-teal)]">
            <Sparkles size={15} />
            {PET_SLOGAN}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={ctaPrimaryHref}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {ctaPrimaryLabel} <ArrowRight size={16} />
            </Link>
            <a
              href="#auto-videos"
              className="inline-flex items-center justify-center rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-secondary"
            >
              看自动生成的视频
            </a>
            <a
              href="#investor"
              className="inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            >
              投资亮点摘要
            </a>
          </div>

          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            {heroStats.map((stat) => (
              <HeroStatCard key={stat.label} stat={stat} />
            ))}
          </dl>

          {PET_WALKTHROUGH_VIDEO_URL ? (
            <div className="mt-8 inline-flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                可选 · 60 秒产品讲解
              </span>
              <a
                href={PET_WALKTHROUGH_VIDEO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground transition hover:opacity-80"
              >
                <Play size={12} /> 播放
              </a>
            </div>
          ) : null}
        </div>

        <div className="relative flex-1">
          <div className="absolute -inset-10 -z-10 rounded-[3rem] bg-[var(--pet-orange)]/15 blur-3xl" />
          <div className="flex flex-col items-center gap-4">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pet-teal)]/30 bg-[var(--pet-teal)]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--pet-teal)]">
              自动生成 · 真实可播放
            </p>
            <PhoneVideoMockup
              sizeClassName="h-[520px] w-[260px] xl:h-[560px] xl:w-[280px]"
              videoUrl={PET_SAMPLE_VIDEO_URL}
              posterUrl={PET_SAMPLE_VIDEO_POSTER}
              videoMode="autoplay"
              caption="今日份可爱 · AI 自动剪辑"
              statusBadge="30s · 9:16"
              fallbackGradient="from-amber-300/40 via-orange-200/30 to-emerald-300/30"
              fallbackTitle="今日份可爱"
              fallbackSubtitle="Aivora 自动生成"
            />
            <p className="text-center text-xs leading-5 text-muted-foreground">
              从宠物的真实瞬间，到一条可以发出去的视频
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroStatCard({ stat }: { stat: HeroStat }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <dt className="text-xs tracking-wide text-muted-foreground">
        {stat.label}
      </dt>
      <dd className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">
        {stat.value}
      </dd>
      {stat.hint ? (
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground/80">
          {stat.hint}
        </p>
      ) : null}
    </div>
  );
}
