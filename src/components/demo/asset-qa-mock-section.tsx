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
    label: "可用",
    color: "bg-success/10 text-success border-success",
    icon: <CheckCircle2 size={14} />,
  },
  BARELY_USABLE: {
    label: "勉强可用",
    color: "bg-warning/10 text-warning border-warning",
    icon: <AlertCircle size={14} />,
  },
  RETAKE_RECOMMENDED: {
    label: "建议重拍",
    color: "bg-danger/10 text-danger border-danger",
    icon: <AlertCircle size={14} />,
  },
  MISSING: {
    label: "缺失",
    color: "bg-danger/10 text-danger border-danger",
    icon: <XCircle size={14} />,
  },
};

export function AssetQAMockSection() {
  return (
    <DemoSection
      id="asset-qa"
      eyebrow="第 6 步 · 素材质检"
      title="每段素材在出片前都会按分镜核对一次。"
      description="规则 + AI vision 的混合质检：分辨率、方向、抖动、亮度，以及是否匹配必拍镜头。下面是 mock 结果，第一版 UI 不接真实上传。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <UploadDropzone />
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div className="grid min-w-[760px] grid-cols-[1.4fr_1fr_1fr_1fr_1.5fr] gap-3 border-b border-border bg-muted px-4 py-3 text-meta font-medium uppercase tracking-widest text-muted-foreground">
            <span>素材 · 匹配镜头</span>
            <span>状态</span>
            <span>方向</span>
            <span>评分</span>
            <span>原因 / 建议</span>
          </div>
          <ul className="min-w-[760px] divide-y divide-border">
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
    <div className="flex flex-col gap-4 rounded-lg border border-dashed border-border bg-muted p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CloudUpload size={22} />
        </div>
        <div>
          <p className="text-sm font-semibold">上传你拍的真实素材</p>
          <p className="text-xs text-muted-foreground">
            按分镜逐个上传素材。当前为示例 UI，不会真正上传。
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
              className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-2">
                <Clapperboard size={12} className="text-muted-foreground" />
                <span className="font-mono text-meta text-primary">
                  S{shot.sceneIndex}
                </span>
                <span className="font-medium">{shot.shotTypeLabel}</span>
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-meta font-medium",
                  isMissing
                    ? "bg-danger/10 text-danger"
                    : "bg-success/10 text-success",
                )}
              >
                {isMissing ? "必拍 · 缺失" : "已上传"}
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
        <p className="mt-1 text-meta text-muted-foreground">
          {row.matchedSceneIndex
            ? `匹配 · 镜头 ${String(row.matchedSceneIndex).padStart(2, "0")}`
            : "未匹配到分镜"}
        </p>
        {row.isCoverCandidate ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-meta text-primary">
            <ImageIcon size={10} /> 候选封面
          </span>
        ) : null}
      </div>

      <div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-meta font-medium",
            cfg.color,
          )}
        >
          {cfg.icon}
          {row.statusLabel}
        </span>
      </div>

      <div className="capitalize text-muted-foreground">
        {orientationZh(row.orientation)}
      </div>

      <div>
        {isMissing ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="space-y-1.5">
            <ScoreBar label="清晰度" value={row.scores.clarity} />
            <ScoreBar label="光线" value={row.scores.lighting} />
            <ScoreBar label="稳定度" value={row.scores.stability} />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <ul className="space-y-0.5 text-meta text-muted-foreground">
          {row.reasons.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
              {r}
            </li>
          ))}
        </ul>
        {row.retakeSuggestion ? (
          <p className="rounded-md bg-warning/10 px-2.5 py-1.5 text-meta leading-4 text-warning">
            {row.retakeSuggestion}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function orientationZh(o: AssetQAResultDemo["orientation"]): string {
  if (o === "portrait") return "竖屏";
  if (o === "landscape") return "横屏";
  if (o === "square") return "方屏";
  return "未知";
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-meta uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            value >= 80
              ? "bg-success"
              : value >= 60
                ? "bg-warning"
                : "bg-danger",
          )}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <span className="w-7 text-right font-mono text-meta text-foreground">
        {value}
      </span>
    </div>
  );
}
