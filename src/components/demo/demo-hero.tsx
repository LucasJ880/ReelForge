import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import {
  PRODUCT_WALKTHROUGH_VIDEO_URL,
  mainConceptVideo,
  storyboardShots,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { PhoneVideoMockup } from "./phone-video-mockup";

interface DemoHeroProps {
  ctaPrimaryHref: string;
  ctaPrimaryLabel: string;
}

export function DemoHero({ ctaPrimaryHref, ctaPrimaryLabel }: DemoHeroProps) {
  const heroShot = storyboardShots[0];

  return (
    <section className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 ambient-glow" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-5 pb-12 pt-8 sm:px-8 lg:flex-row lg:items-center lg:gap-16 lg:px-10 lg:pb-20 lg:pt-14">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles size={14} />
            产品工作流体验 · 实时预览
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            把真实素材跑成本地商家能直接用的视频初稿。
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Aivora 帮本地商家选定一个有效果的内容方向，自动生成脚本与分镜，
            质检你的素材，把工作流跑完——产出右边这种风格的成片初稿。
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground/85">
            输入目标，选择方向，按 AI 分镜拍摄素材，系统帮你质检并生成可发布的
            视频初稿。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={ctaPrimaryHref}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {ctaPrimaryLabel} <ArrowRight size={16} />
            </Link>
            <a
              href="#final-output"
              className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
            >
              先看 Demo 样片
            </a>
            <a
              href="#workflow"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5"
            >
              查看完整流程
            </a>
          </div>

          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            <HeroStat label="创意方向" value="3" />
            <HeroStat label="分镜镜头" value="6" />
            <HeroStat label="输出版本" value="6" />
          </dl>

          {PRODUCT_WALKTHROUGH_VIDEO_URL ? (
            <div className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                可选 · 60 秒产品 walkthrough
              </span>
              <a
                href={PRODUCT_WALKTHROUGH_VIDEO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-foreground transition hover:bg-white/10"
              >
                播放 <ArrowRight size={12} />
              </a>
            </div>
          ) : null}
        </div>

        <div className="relative flex-1">
          <div className="absolute -inset-10 -z-10 rounded-[3rem] bg-primary/15 blur-3xl" />
          <div className="flex flex-col items-center gap-4">
            <PhoneVideoMockup
              size="lg"
              videoUrl={mainConceptVideo.url}
              posterUrl={mainConceptVideo.posterUrl}
              videoMode="autoplay"
              caption="概念样片 · 工作流走完后的成片质感"
              statusBadge={`${mainConceptVideo.aspectRatio} · ${mainConceptVideo.durationLabel}`}
              fallbackGradient="from-emerald-500/30 via-sky-500/20 to-violet-500/25"
              fallbackTitle={heroShot.captionText}
              fallbackSubtitle={heroShot.voiceoverSegment}
            />
            <p className="max-w-xs text-center text-xs leading-5 text-muted-foreground">
              概念样片（concept sample）：用来展示工作流跑完后的成片风格。最终
              成片由你的脚本、分镜和审核通过的素材决定。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}
