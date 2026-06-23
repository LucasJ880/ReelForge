import Link from "next/link";
import { ArrowRight, PawPrint, Sparkles } from "lucide-react";
import { PetImage } from "./pet-image";
import {
  PET_HERO_OPENING,
  PET_RENDER,
  PET_SLOGAN,
  PET_WALKTHROUGH_VIDEO_POSTER,
  PET_WALKTHROUGH_VIDEO_URL,
  heroStats,
  type HeroStat,
} from "@/lib/demo/pet-content-kit-demo-data";

const HERO_DEVICE_THUMBS = [
  { src: PET_RENDER.cam360, label: "360° 摄像头" },
  { src: PET_RENDER.collarCam, label: "第一视角项圈" },
  { src: PET_RENDER.smartMat, label: "智能宠物垫" },
] as const;

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
              href="#before-after"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-secondary"
            >
              <Sparkles size={15} /> 看真实成片对比
            </a>
            <a
              href="#proof-report"
              className="inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            >
              查看品牌证据 Demo
            </a>
          </div>

          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            {heroStats.map((stat) => (
              <HeroStatCard key={stat.label} stat={stat} />
            ))}
          </dl>
        </div>

        <div className="relative flex-1">
          <div className="absolute -inset-10 -z-10 rounded-[3rem] bg-[var(--pet-orange)]/15 blur-3xl" />
          <div className="flex flex-col items-center gap-4">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pet-teal)]/30 bg-[var(--pet-teal)]/10 px-3 py-1 text-[11px] font-semibold text-[color:var(--pet-teal)]">
              <Sparkles size={13} /> 60 秒看懂 Aivora · 中文字幕 + 纯音乐
            </p>
            {PET_WALKTHROUGH_VIDEO_URL ? (
              <figure className="w-full max-w-xl overflow-hidden rounded-3xl border border-border bg-card p-2 shadow-xl shadow-[var(--pet-orange)]/10">
                {/* 投资人最先看到的视频：产品讲解片，可播放、有声。 */}
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={PET_WALKTHROUGH_VIDEO_POSTER ?? undefined}
                  className="aspect-video w-full rounded-2xl bg-black object-cover"
                >
                  <source src={PET_WALKTHROUGH_VIDEO_URL} type="video/mp4" />
                </video>
              </figure>
            ) : (
              <div className="flex aspect-video w-full max-w-xl items-center justify-center rounded-3xl border border-border bg-linear-to-br from-amber-300/40 via-orange-200/30 to-emerald-300/30 text-sm font-medium text-foreground">
                产品讲解视频即将上线
              </div>
            )}
            <p className="max-w-md text-center text-xs leading-5 text-muted-foreground">
              纯音乐播放 · 讲清我们做什么、怎么自动生产可裂变的宠物视频、为什么要用我们
            </p>

            <a
              href="#hardware-kit"
              className="group mt-2 w-full max-w-xl rounded-3xl border border-border bg-card/70 p-3 transition hover:border-[var(--pet-orange)]/40"
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-[11px] font-semibold text-foreground">
                  Aivora 自有硬件套装
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--pet-orange)]">
                  查看套装 <ArrowRight size={12} />
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {HERO_DEVICE_THUMBS.map((thumb) => (
                  <figure key={thumb.label} className="overflow-hidden rounded-2xl">
                    <PetImage
                      src={thumb.src}
                      alt={thumb.label}
                      className="aspect-4/3 object-cover transition group-hover:scale-[1.03]"
                      fallbackLabel={thumb.label}
                    />
                    <figcaption className="mt-1 text-center text-[10px] text-muted-foreground">
                      {thumb.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </a>
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
