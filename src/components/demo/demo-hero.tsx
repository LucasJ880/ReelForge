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
    <section className="relative isolate overflow-hidden bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 pb-14 pt-10 sm:px-6 lg:flex-row lg:items-center lg:gap-12 lg:px-10 lg:pb-24 lg:pt-16">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles size={14} />
            投资人版本 · 两个真实北美客户案例
          </div>
          {/* 中文按短语换行；390px 下允许自然折行，数字短语保持完整。 */}
          <h1 className="editorial-display mt-6 max-w-3xl break-keep [line-break:strict]">
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
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              {ctaPrimaryLabel} <ArrowRight size={16} />
            </Link>
            <a
              href="#final-output"
              className="inline-flex items-center justify-center rounded-full border border-border px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted"
            >
              直接看成片
            </a>
            <a
              href="#investor"
              className="inline-flex items-center justify-center rounded-full border border-border bg-muted px-5 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
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
            <div className="mt-8 inline-flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                可选 · 60 秒产品 walkthrough
              </span>
              <a
                href={PRODUCT_WALKTHROUGH_VIDEO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
              >
                播放 <ArrowRight size={12} />
              </a>
            </div>
          ) : null}
        </div>

        <div className="relative flex-1">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:gap-4">
            <CaseColumn
              eyebrow="案例 A · 投资级品牌叙事"
              brand={mainConceptVideo.brandName}
              tagline="Comfort, with independence."
              videoUrl={mainConceptVideo.url}
              posterUrl={mainConceptVideo.posterUrl}
              statusBadge={`${mainConceptVideo.aspectRatio} · ${mainConceptVideo.durationLabel}`}
              caption="加拿大电动智能卷帘 · 投资人版本"
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
  fallbackTitle?: string;
  tone: "primary" | "neutral";
}) {
  const tonePill =
    tone === "primary"
      ? "border-primary/40 bg-primary/15 text-primary"
      : "border-border bg-muted text-foreground/85";
  return (
    <div className="flex flex-col items-center gap-3">
      <p
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold uppercase tracking-[0.2em] ${tonePill}`}
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
    <div className="rounded-lg border border-border bg-muted p-4">
      <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}
