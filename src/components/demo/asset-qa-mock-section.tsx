import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  CloudUpload,
  Image as ImageIcon,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  assetQAResults,
  storyboardShots,
  type AssetQAResultDemo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";

const STATUS_CONFIG: Record<
  AssetQAResultDemo["status"],
  { label: string; color: string; icon: React.ReactNode }
> = {
  USABLE: {
    label: "Usable",
    color: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
    icon: <CheckCircle2 size={14} />,
  },
  BARELY_USABLE: {
    label: "Barely usable",
    color: "bg-amber-500/15 text-amber-200 border-amber-400/30",
    icon: <AlertCircle size={14} />,
  },
  RETAKE_RECOMMENDED: {
    label: "Retake recommended",
    color: "bg-orange-500/15 text-orange-200 border-orange-400/30",
    icon: <AlertCircle size={14} />,
  },
  MISSING: {
    label: "Missing",
    color: "bg-rose-500/15 text-rose-200 border-rose-400/30",
    icon: <XCircle size={14} />,
  },
};

export function AssetQAMockSection() {
  return (
    <DemoSection
      id="asset-qa"
      eyebrow="Step 6 · Asset QA"
      title="Each clip is checked against the storyboard before render."
      description="规则 + AI vision 的混合质检：分辨率、方向、抖动、亮度、是否匹配必拍镜头。这里展示的是 mock 结果，第一版 UI 不接真实上传。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <UploadDropzone />
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-card/60">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1.5fr] gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span>Asset · matched shot</span>
            <span>Status</span>
            <span>Orientation</span>
            <span>Scores</span>
            <span>Reason / suggestion</span>
          </div>
          <ul className="divide-y divide-white/5">
            {assetQAResults.map((row) => (
              <QARow key={row.assetName} row={row} />
            ))}
          </ul>
        </div>
      </div>
    </DemoSection>
  );
}

function UploadDropzone() {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <CloudUpload size={22} />
        </div>
        <div>
          <p className="text-sm font-semibold">Upload your real footage</p>
          <p className="text-xs text-muted-foreground">
            Drop clips per storyboard shot. Mock UI — does not actually upload.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {storyboardShots.map((shot) => {
          const matched = assetQAResults.find(
            (r) => r.matchedSceneIndex === shot.sceneIndex,
          );
          const isMissing = !matched || matched.status === "MISSING";
          return (
            <li
              key={shot.sceneIndex}
              className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-2">
                <Clapperboard size={12} className="text-muted-foreground" />
                <span className="font-mono text-[10px] text-primary">
                  S{shot.sceneIndex}
                </span>
                <span className="font-medium">{shot.shotTypeLabel}</span>
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  isMissing
                    ? "bg-rose-500/15 text-rose-200"
                    : "bg-emerald-500/15 text-emerald-200",
                )}
              >
                {isMissing ? "Required · missing" : "Uploaded"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QARow({ row }: { row: AssetQAResultDemo }) {
  const cfg = STATUS_CONFIG[row.status];
  const isMissing = row.status === "MISSING";

  return (
    <li className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1.5fr] items-start gap-3 px-4 py-3 text-xs">
      <div>
        <p className="font-medium">{row.assetName}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {row.matchedSceneIndex
            ? `Matched · Shot ${String(row.matchedSceneIndex).padStart(2, "0")}`
            : "No matched shot"}
        </p>
        {row.isCoverCandidate ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
            <ImageIcon size={10} /> Cover candidate
          </span>
        ) : null}
      </div>

      <div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            cfg.color,
          )}
        >
          {cfg.icon}
          {row.statusLabel}
        </span>
      </div>

      <div className="capitalize text-muted-foreground">{row.orientation}</div>

      <div>
        {isMissing ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="space-y-1.5">
            <ScoreBar label="Clarity" value={row.scores.clarity} />
            <ScoreBar label="Lighting" value={row.scores.lighting} />
            <ScoreBar label="Stability" value={row.scores.stability} />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {row.reasons.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
              {r}
            </li>
          ))}
        </ul>
        {row.retakeSuggestion ? (
          <p className="rounded-xl bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-4 text-amber-200">
            {row.retakeSuggestion}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn(
            "h-full rounded-full",
            value >= 80
              ? "bg-emerald-400"
              : value >= 60
                ? "bg-amber-400"
                : "bg-rose-400",
          )}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <span className="w-7 text-right font-mono text-[11px] text-foreground">
        {value}
      </span>
    </div>
  );
}
