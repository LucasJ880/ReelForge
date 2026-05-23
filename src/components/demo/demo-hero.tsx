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
           * 中文标题排版（mobile-first，desktop 也要可控）：
           *   1. `break-keep + line-break: strict` 禁止中文按字符 break；
           *   2. nowrap span 锁住数字短语（"30 秒成片"/"AI 视频管线"），永远不被
           *      拆成"30 / 秒成片"；
           *   3. 用**普通空格**而非 `&nbsp;` 连接「从客户输入到」与「30 秒成片，」
           *      —— mobile 390 viewport 下 nbsp 会让整段 432px 不可 break 触发
           *      horizontal overflow（截掉右边），普通空格在 mobile 自然 break；
           *   4. desktop 端 `<br className="hidden sm:inline" />` 显式换行，sm+
           *      左 column 容器宽度（lg≈448 / xl≈576）配合下方字号：
           *      - lg:text-[2.125rem]（34px）→ 12 char × 34 = 408 ≤ 448 ✓
           *      - xl:text-[2.875rem]（46px）→ 12 char × 46 = 552 ≤ 576 ✓
           *      保证 "从客户输入到 30 秒成片，" 在 sm+ 整段一行不 break；
           *   5. 不再追求 3.25rem 极大字号——hero 双 phone 占了一半视宽，文字 column
           *      留给标题的实际宽度有限，硬塞大字号只会让 wrap 不可控。
           */}
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl sm:leading-[1.15] lg:text-[2.125rem] lg:leading-[1.2] xl:text-[2.875rem] xl:leading-[1.18] break-keep [line-break:strict]">
            从客户输入到{" "}
            <span className="whitespace-nowrap">30 秒成片，</span>
            <br className="hidden sm:inline" />
            把整支{" "}
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
      {/*
       * Responsive sizing —— hero 右侧需要两个 phone 并排，但 flex-1 容器在
       * lg viewport (1024) 下只有 ~470px 宽，装不下两个 260px md phone（536px
       * 含 gap）。所以：
       *   - 默认 (mobile + sm)：h-[520px] w-[260px]（单列，与 md 一致）
       *   - lg (1024-1279)：h-[460px] w-[210px]（双列并排刚好装下，~436px）
       *   - xl (1280+)：h-[540px] w-[250px]（更大屏幕用大 phone，~516px）
       * 不再依赖 size="md" preset，由父级直接通过 sizeClassName 控制响应式。
       */}
      <PhoneVideoMockup
        sizeClassName="h-[520px] w-[260px] lg:h-[460px] lg:w-[210px] xl:h-[540px] xl:w-[250px]"
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
