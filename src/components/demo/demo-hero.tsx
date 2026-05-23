import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import {
  PRODUCT_WALKTHROUGH_VIDEO_URL,
  localProductSample,
  mainConceptVideo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { PhoneVideoMockup } from "./phone-video-mockup";

interface DemoHeroProps {
  ctaPrimaryHref: string;
  ctaPrimaryLabel: string;
}

export function DemoHero({ ctaPrimaryHref, ctaPrimaryLabel }: DemoHeroProps) {
  return (
    <section className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 ambient-glow" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-5 pb-14 pt-10 sm:px-8 lg:flex-row lg:items-center lg:gap-12 lg:px-10 lg:pb-24 lg:pt-16">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles size={14} />
            投资人版本 · 两个真实北美客户案例
          </div>
          {/*
           * 中文标题排版：
           *   1. `word-break: keep-all + line-break: strict` 禁止中文按字符断行；
           *   2. 数字 + 中文短语（"30 秒成片"、"AI 视频管线"）用 whitespace-nowrap 锁定，
           *      避免浏览器在「数字+空格+中文」处把它们拆开变成「30 / 秒成片」；
           *   3. lg 字号控制在 2.5rem（40px），确保 hero 双 column 布局下左侧 ~570px
           *      宽度能完整装下「从客户输入到 30 秒成片，」整行，break 只发生在 "，" 后；
           *   4. xl 屏放宽到 3.25rem，给投资人更强的视觉冲击力。
           */}
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[2.5rem] lg:leading-[1.15] xl:text-[3.25rem] [word-break:keep-all] [line-break:strict]">
            从客户输入到&nbsp;
            <span className="whitespace-nowrap">30 秒成片，</span>
            <br className="hidden sm:inline" />
            把整支&nbsp;
            <span className="whitespace-nowrap">AI 视频管线</span>
            跑一遍。
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Aivora 把客户输入、创意方向、AI 脚本、分镜、素材质检与成片拼装合在同一个工作流里。
            下面用两个真实北美客户案例完整演示——一个高端智能家居品牌，一个本地家居零售品牌。
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground/85">
            上半段用 <strong className="text-foreground">Sunny Shutter</strong>（加拿大电动智能卷帘品牌）
            走完整 7 步工作流，最终输出位接入真实生成的 30 秒投资人版本成片；
            下半段用 <strong className="text-foreground">Mapleside Living</strong>（多伦多本地家居织物品牌）
            证明同一套工作流也能服务本地零售商家。
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
              直接看成片
            </a>
            <a
              href="#investor"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/3 px-5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5"
            >
              投资亮点摘要
            </a>
          </div>

          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            <HeroStat label="真实客户案例" value="2" />
            <HeroStat label="成片可播放" value="100%" />
            <HeroStat label="单条成片成本" value="≈ US$12" />
          </dl>

          {PRODUCT_WALKTHROUGH_VIDEO_URL ? (
            <div className="mt-8 inline-flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-muted-foreground">
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
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:gap-4">
            <CaseColumn
              eyebrow="案例 A · 投资级品牌叙事"
              brand={mainConceptVideo.brandName}
              tagline="Comfort, with independence."
              videoUrl={mainConceptVideo.url}
              posterUrl={mainConceptVideo.posterUrl}
              statusBadge={`${mainConceptVideo.aspectRatio} · ${mainConceptVideo.durationLabel}`}
              caption="加拿大电动智能卷帘 · 投资人版本"
              fallbackGradient="from-amber-400/30 via-rose-400/15 to-violet-500/20"
              fallbackTitle={mainConceptVideo.title}
              tone="primary"
            />
            <CaseColumn
              eyebrow="案例 B · 本地零售批量化"
              brand={localProductSample.brandName}
              tagline="本地家居织物 · 周下单转化"
              videoUrl={localProductSample.videoUrl}
              posterUrl={localProductSample.thumbnailUrl}
              statusBadge={`${localProductSample.aspectRatio} · 30 秒成片`}
              caption="多伦多本地家居织物 · 批量化样片"
              fallbackGradient="from-amber-300/30 via-amber-500/15 to-emerald-500/20"
              fallbackTitle={localProductSample.title}
              tone="neutral"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function CaseColumn({
  eyebrow,
  brand,
  tagline,
  videoUrl,
  posterUrl,
  statusBadge,
  caption,
  fallbackGradient,
  fallbackTitle,
  tone,
}: {
  eyebrow: string;
  brand: string;
  tagline: string;
  videoUrl?: string | null;
  posterUrl?: string | null;
  statusBadge?: string;
  caption?: string;
  fallbackGradient?: string;
  fallbackTitle?: string;
  tone: "primary" | "neutral";
}) {
  const tonePill =
    tone === "primary"
      ? "border-primary/40 bg-primary/15 text-primary"
      : "border-white/15 bg-white/5 text-foreground/85";
  return (
    <div className="flex flex-col items-center gap-3">
      <p
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${tonePill}`}
      >
        {eyebrow}
      </p>
      <PhoneVideoMockup
        size="md"
        videoUrl={videoUrl}
        posterUrl={posterUrl}
        videoMode="autoplay"
        caption={caption}
        statusBadge={statusBadge}
        fallbackGradient={fallbackGradient}
        fallbackTitle={fallbackTitle}
        fallbackSubtitle="Aivora 工作流 · 真实成片"
      />
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">{brand}</p>
        <p className="text-xs leading-5 text-muted-foreground">{tagline}</p>
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
      <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}
