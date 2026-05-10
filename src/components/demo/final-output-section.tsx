import { Hourglass } from "lucide-react";
import {
  finalOutputs,
  type FinalOutputDemo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";
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
 * 房地产工作流的最终输出区。
 *
 * 当前状态：房地产真实成片仍在制作中，整个 final output 区都按 placeholder
 * 渲染。30 秒主版本（main_30s）作为视觉焦点占据主卡；15 秒广告版、封面图、
 * 平台文案降级为小号 secondary chips 列在主卡下方，避免和主卡同等视觉权重。
 *
 * 房地产样片做好后只要把 main_30s.videoUrl 接上即可，UI 不需要改。
 *
 * 注意：本地毛毯 / 家居用品的概念样片不应该出现在这一段，它属于下方的
 * LocalProductSampleSection。
 */
export function FinalOutputSection() {
  const main = finalOutputs.find((o) => o.variant === "main_30s");
  const secondary = finalOutputs.filter((o) => o.variant !== "main_30s");

  return (
    <DemoSection
      id="final-output"
      eyebrow="第 7 步 · 房地产工作流 · 最终输出"
      title="房地产样片位：North York Condo 视频即将接入。"
      description={
        <>
          <p>
            当前页面先展示完整的房地产工作流：从客户输入、创意证据卡、参考结构、
            AI 脚本、分镜，到素材质检。最终的房地产 30 秒主版本仍在制作中，
            做好后会直接替换下方占位卡。
          </p>
          <p className="mt-2 text-xs text-muted-foreground/85">
            想先看一段「同一套工作流跑完后能产出的成片风格」？往下滑一段，看
            本地毛毯产品商家的真实概念样片。
          </p>
        </>
      }
      rightSlot={<SampleDataBadge label="Coming next" />}
    >
      {main ? <MainPlaceholderCard output={main} /> : null}

      <div className="mt-6 rounded-3xl border border-white/10 bg-card/50 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            其它配套输出 · 同样 Coming next
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            主版本接入后，下列配套输出会按相同方向自动生成
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

function MainPlaceholderCard({ output }: { output: FinalOutputDemo }) {
  return (
    <div className="flex flex-col gap-6 overflow-hidden rounded-[2rem] border border-primary/40 bg-card/70 p-5 ring-1 ring-primary/20 sm:p-6 lg:grid lg:grid-cols-[auto_1fr] lg:items-start lg:gap-8">
      <PhoneVideoMockup
        size="md"
        videoUrl={output.videoUrl}
        posterUrl={output.posterUrl}
        videoMode="preview"
        statusBadge={`${output.aspectRatio} · ${output.durationSec ?? "—"}s`}
        fallbackGradient="from-emerald-400/30 via-sky-500/20 to-violet-500/25"
        fallbackTitle={output.title}
        fallbackSubtitle="房地产样片做好后会直接接入这里"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            房地产主版本 · Coming next
          </span>
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
            <Hourglass size={11} />
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
  return (
    <li className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary/90">
          {VARIANT_LABEL[output.variant]}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-200">
          <Hourglass size={9} />
          Coming next
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
