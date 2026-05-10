import {
  finalOutputs,
  type FinalOutputDemo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";
import { PhoneVideoMockup } from "./phone-video-mockup";

const VIDEO_VARIANTS: ReadonlyArray<FinalOutputDemo["variant"]> = [
  "main_30s",
  "ad_15s",
];

export function FinalOutputSection() {
  const main = finalOutputs.find((o) => o.variant === "main_30s");
  const ad15 = finalOutputs.find((o) => o.variant === "ad_15s");
  const cover = finalOutputs.find((o) => o.variant === "cover");
  const captionVariants = finalOutputs.filter(
    (o) => !VIDEO_VARIANTS.includes(o.variant) && o.variant !== "cover",
  );

  return (
    <DemoSection
      id="final-output"
      eyebrow="第 7 步 · 最终输出"
      title="基于你确认的脚本、分镜与上传素材自动生成的成片初稿。"
      description="第一版展示的是预生成示例（sample preview）。所有视频位允许是占位（不会因为缺 mp4 崩页），后续接入 wizard 真实输出后会自动替换。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {main ? <FinalVideoCard output={main} accent="primary" /> : null}
        {ad15 ? <FinalVideoCard output={ad15} accent="secondary" /> : null}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_2.1fr]">
        {cover ? <CoverCard output={cover} /> : null}
        <div className="rounded-3xl border border-white/10 bg-card/60 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            各平台版本
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {captionVariants.map((variant) => (
              <li
                key={variant.variant}
                className="rounded-2xl bg-white/[0.04] p-4 text-xs leading-5"
              >
                <p className="text-sm font-semibold">{variant.title}</p>
                <p className="mt-1 text-muted-foreground">
                  {variant.description}
                </p>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {variant.notes.map((n) => (
                    <li key={n} className="flex gap-1.5">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </DemoSection>
  );
}

function FinalVideoCard({
  output,
  accent,
}: {
  output: FinalOutputDemo;
  accent: "primary" | "secondary";
}) {
  return (
    <div
      className={
        "flex flex-col gap-5 overflow-hidden rounded-[2rem] border bg-card/70 p-6 sm:flex-row " +
        (accent === "primary"
          ? "border-primary/40 ring-1 ring-primary/20"
          : "border-white/10")
      }
    >
      <PhoneVideoMockup
        size="md"
        videoUrl={output.videoUrl}
        posterUrl={output.posterUrl}
        statusBadge={`${output.aspectRatio} · ${output.durationSec ?? "—"}s`}
        fallbackGradient={
          output.variant === "main_30s"
            ? "from-emerald-400/30 via-sky-500/20 to-violet-500/25"
            : "from-rose-500/25 via-amber-400/15 to-emerald-400/20"
        }
        fallbackTitle={output.title}
        fallbackSubtitle={output.description.split(";")[0]}
      />
      <div className="flex flex-1 flex-col">
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {output.badge}
        </span>
        <h3 className="mt-3 text-xl font-semibold leading-snug">{output.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {output.description}
        </p>
        <ul className="mt-4 space-y-1.5 text-xs leading-5 text-muted-foreground">
          {output.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CoverCard({ output }: { output: FinalOutputDemo }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-card/70">
      <div className="aspect-9/16 max-h-72 w-full bg-gradient-to-br from-emerald-400/30 via-sky-500/15 to-transparent">
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-white">
          <p className="text-[10px] uppercase tracking-[0.28em] text-white/55">
            封面 · 9:16
          </p>
          <p className="text-base font-semibold leading-snug">
            North York 公寓 · 示例封面
          </p>
          <p className="text-[10px] text-white/70">
            自动取自镜头 02 静帧
          </p>
        </div>
      </div>
      <div className="p-4">
        <p className="text-sm font-semibold">{output.title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {output.description}
        </p>
      </div>
    </div>
  );
}
