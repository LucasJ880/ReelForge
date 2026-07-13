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
    <section className="relative isolate overflow-hidden bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 pb-14 pt-10 sm:px-6 lg:flex-row lg:items-center lg:gap-12 lg:px-10 lg:pb-20 lg:pt-14">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <PawPrint size={14} />
            Aivora 宠物内容智能采集套件
          </div>
          <h1 className="editorial-display mt-6 max-w-3xl break-keep text-foreground [line-break:strict]">
            把每一个真实宠物瞬间，
            <br />
            变成<span className="text-primary">可以马上分享</span>的可爱视频。
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
            {PET_HERO_OPENING}
          </p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-success bg-success/10 px-4 py-2 text-sm font-medium text-success">
            <Sparkles size={15} />
            {PET_SLOGAN}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={ctaPrimaryHref}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              {ctaPrimaryLabel} <ArrowRight size={16} />
            </Link>
            <a
              href="#before-after"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
            >
              <Sparkles size={15} /> 看真实成片对比
            </a>
            <a
              href="#proof-report"
              className="inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
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
          <div className="flex flex-col items-center gap-4">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-success bg-success/10 px-3 py-1 text-meta font-semibold text-success">
              <Sparkles size={13} /> 60 秒看懂 Aivora · 中文字幕 + 纯音乐
            </p>
            {PET_WALKTHROUGH_VIDEO_URL ? (
              <figure className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card p-2 shadow-editorial">
                {/* 投资人最先看到的视频：产品讲解片，可播放、有声。 */}
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={PET_WALKTHROUGH_VIDEO_POSTER ?? undefined}
                  className="aspect-video w-full rounded-lg bg-foreground object-cover"
                >
                  <source src={PET_WALKTHROUGH_VIDEO_URL} type="video/mp4" />
                </video>
              </figure>
            ) : (
              <div className="flex aspect-video w-full max-w-xl items-center justify-center rounded-lg border border-border bg-muted text-sm font-medium text-foreground">
                产品讲解视频即将上线
              </div>
            )}

            <a
              href="#hardware-kit"
              className="group mt-2 w-full max-w-xl rounded-lg border border-border bg-card p-3 hover:border-primary/40"
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-meta font-semibold text-foreground">
                  Aivora 自有硬件套装
                </span>
                <span className="inline-flex items-center gap-1 text-meta text-primary">
                  查看套装 <ArrowRight size={12} />
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {HERO_DEVICE_THUMBS.map((thumb) => (
                  <figure key={thumb.label} className="overflow-hidden rounded-lg">
                    <PetImage
                      src={thumb.src}
                      alt={thumb.label}
                      className="aspect-4/3 object-cover"
                      fallbackLabel={thumb.label}
                    />
                    <figcaption className="mt-1 text-center text-meta text-muted-foreground">
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
    <div className="rounded-lg border border-border bg-card p-4">
      <dt className="text-xs tracking-wide text-muted-foreground">
        {stat.label}
      </dt>
      <dd className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">
        {stat.value}
      </dd>
      {stat.hint ? (
        <p className="mt-1 text-meta leading-4 text-muted-foreground/80">
          {stat.hint}
        </p>
      ) : null}
    </div>
  );
}
