import { CheckCircle2, Hourglass } from "lucide-react";
import {
  finalOutputs,
  type FinalOutputDemo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection } from "./demo-section";
import { PhoneVideoMockup } from "./phone-video-mockup";

const VARIANT_LABEL: Record<FinalOutputDemo["variant"], string> = {
  main_30s: "30 秒主版本",
  ad_15s: "15 秒广告版",
  cover: "封面图",
  tiktok_caption: "TikTok 文案",
  reels_caption: "Reels 文案",
  shorts_caption: "Shorts 文案",
};

/**
 * Sunny Shutter 工作流的最终输出区。
 *
 * 与早期版本不同：30 秒主版本已经是真实交付的成片（V2.1 image-storyboard-guided I2V
 * 产出，存放在 Vercel Blob），点击主卡上的视频可以直接播放完整 30 秒视频。
 * 其它输出版本（15 秒广告、封面图、平台文案）作为同一支视频的配套交付，
 * 视觉上降级为 secondary chips 列在主卡下方。
 */
export function FinalOutputSection() {
  const main = finalOutputs.find((o) => o.variant === "main_30s");
  const secondary = finalOutputs.filter((o) => o.variant !== "main_30s");

  return (
    <DemoSection
      id="final-output"
      eyebrow="第 7 步 · 最终输出 · 已交付"
      title="Sunny Shutter · 30 秒投资人版本成片。"
      description={
        <>
          <p>
            5 段 image-storyboard-guided I2V + 5 秒真实品牌 end card，由 Aivora V2.1
            管线一次跑出。点击下方手机里的视频即可播放完整 30 秒成片——这就是同一套工作流跑完后真实交付的样子。
          </p>
          <p className="mt-2 text-xs text-muted-foreground/85">
            想看本地零售商家场景下同一套工作流的成片？继续往下滑，看
            <a
              href="#local-product-sample"
              className="ml-1 font-semibold text-primary underline decoration-dotted underline-offset-4 hover:text-primary"
            >
              Mapleside Living
            </a>
            的概念样片。
          </p>
        </>
      }
      rightSlot={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-emerald-200">
          <CheckCircle2 size={11} />
          已交付 · 可播放
        </span>
      }
    >
      {main ? <MainDeliveredCard output={main} /> : null}

      <div className="mt-6 rounded-3xl border border-white/10 bg-card/50 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            配套交付 · 同一组镜头自动派生
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            投放素材、封面图与平台文案均按同一方向自动生成
          </p>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {secondary.map((variant) => (
            <SecondaryChip key={variant.variant} output={variant} />
          ))}
        </ul>
      </div>
    </DemoSection>
  );
}

function MainDeliveredCard({ output }: { output: FinalOutputDemo }) {
  return (
    <div className="flex flex-col gap-6 overflow-hidden rounded-[2rem] border border-primary/40 bg-card/70 p-5 ring-1 ring-primary/20 sm:p-6 lg:grid lg:grid-cols-[auto_1fr] lg:items-start lg:gap-8">
      <PhoneVideoMockup
        size="md"
        videoUrl={output.videoUrl}
        posterUrl={output.posterUrl}
        videoMode="preview"
        statusBadge={`${output.aspectRatio} · ${output.durationSec ?? "—"}s`}
        fallbackGradient="from-amber-400/30 via-rose-400/15 to-violet-500/20"
        fallbackTitle={output.title}
        fallbackSubtitle="点击播放完整 30 秒成片"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] text-primary">
            投资级品牌叙事
          </span>
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] tracking-[0.18em] text-emerald-200">
            <CheckCircle2 size={11} />
            {output.badge}
          </span>
        </div>
        <h3 className="mt-3 text-lg font-semibold leading-snug sm:text-xl">
          {output.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground wrap-break-word">
          {output.description}
        </p>
        <ul className="mt-4 space-y-1.5 text-xs leading-5 text-muted-foreground">
          {output.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span className="wrap-break-word">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SecondaryChip({ output }: { output: FinalOutputDemo }) {
  const isReady = !output.isPlaceholder;
  return (
    <li className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/3 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary/90">
          {VARIANT_LABEL[output.variant]}
        </span>
        <span
          className={
            isReady
              ? "inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-emerald-200"
              : "inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-200"
          }
        >
          {isReady ? <CheckCircle2 size={9} /> : <Hourglass size={9} />}
          {output.badge}
        </span>
      </div>
      <p className="text-[11px] font-medium leading-snug text-foreground/90 wrap-break-word">
        {output.title}
      </p>
      <p className="text-[11px] leading-4 text-muted-foreground wrap-break-word">
        {output.notes[0] ?? output.description}
      </p>
    </li>
  );
}
