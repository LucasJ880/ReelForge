import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import {
  PRODUCT_WALKTHROUGH_VIDEO_URL,
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
            Live product workflow preview
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Turn proven creative patterns into original videos using your real
            footage.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            输入目标，选择方向，按 AI 分镜拍摄素材，系统帮你质检并生成可发布的
            视频初稿。这条页面是一次完整的产品体验：从客户输入到最终视频，按真实
            生产步骤一步步走完。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={ctaPrimaryHref}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {ctaPrimaryLabel} <ArrowRight size={16} />
            </Link>
            <a
              href="#workflow"
              className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
            >
              See the generation flow
            </a>
            <a
              href="#final-output"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5"
            >
              Jump to final video
            </a>
          </div>

          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            <HeroStat label="Creative directions" value="3" />
            <HeroStat label="Storyboard shots" value="6" />
            <HeroStat label="Output variants" value="6" />
          </dl>

          {PRODUCT_WALKTHROUGH_VIDEO_URL ? (
            <div className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Optional 60s product walkthrough video
              </span>
              <a
                href={PRODUCT_WALKTHROUGH_VIDEO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-foreground transition hover:bg-white/10"
              >
                Watch <ArrowRight size={12} />
              </a>
            </div>
          ) : null}
        </div>

        <div className="relative flex-1">
          <div className="absolute -inset-10 -z-10 rounded-[3rem] bg-primary/15 blur-3xl" />
          <div className="flex flex-col items-center gap-4">
            <PhoneVideoMockup
              size="lg"
              videoUrl={null}
              caption="North York condo · 30s preview"
              statusBadge="9:16 · 30s · sample render"
              fallbackGradient="from-emerald-500/30 via-sky-500/20 to-violet-500/25"
              fallbackTitle={heroShot.captionText}
              fallbackSubtitle={heroShot.voiceoverSegment}
            />
            <p className="max-w-xs text-center text-xs leading-5 text-muted-foreground">
              First frame previews Shot 01 of the storyboard. Final video is
              assembled from your script, storyboard, and approved footage.
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
