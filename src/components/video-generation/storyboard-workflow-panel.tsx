"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Check,
  ChevronDown,
  ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { StatusTick } from "@/components/exchange/status-tick";
import type { VocabState } from "@/lib/exchange/state-vocab";
import { storyboardBeatLabel } from "@/lib/video-generation/storyboard-beats";
import {
  STORYBOARD_FRAME_DIRECTION_MAX,
  STORYBOARD_FRAME_SOURCE_ASSETS_MAX,
} from "@/lib/video-generation/storyboard-frame-inputs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface StoryboardFrameView {
  id: string;
  ordinal: number;
  attempt: number;
  beat: string;
  prompt: string;
  status: string;
  imageUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** False while the provider's billing acknowledgement is unresolved. */
  canRegenerate?: boolean;
}

export interface StoryboardRunView {
  id: string;
  status: string;
  approvalPolicy: string;
  durationSec: number;
  aspectRatio: string;
  approvedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  canApprove: boolean;
  frames: StoryboardFrameView[];
}

/** 一轮故事板应有的关键帧数：15 秒及以内 4 帧，更长 5 帧（创作台的委托摘要也读这个口径）。 */
export function storyboardFrameTarget(durationSec: number): number {
  return durationSec <= 15 ? 4 : 5;
}

/** 重做一帧时可选的商家图（创作台已上传的产品图）。 */
export interface StoryboardReferenceOption {
  assetId: string;
  url: string;
  label: string;
}

/** 重做一帧的可选输入：不填 = 按原方案重抽。 */
export interface StoryboardFrameRegenerateOptions {
  promptOverride?: string;
  sourceAssetIds?: string[];
}

interface FrameDraft {
  open: boolean;
  direction: string;
  assetIds: string[];
}

const EMPTY_DRAFT: FrameDraft = { open: false, direction: "", assetIds: [] };

export function StoryboardWorkflowPanel({
  run,
  english,
  busyFrameId,
  approving,
  referenceOptions = [],
  onRegenerate,
  onApprove,
  onEditPlan,
}: {
  run: StoryboardRunView;
  english: boolean;
  busyFrameId: string | null;
  approving: boolean;
  referenceOptions?: StoryboardReferenceOption[];
  onRegenerate: (frameId: string, options: StoryboardFrameRegenerateOptions) => void;
  onApprove: () => void;
  onEditPlan: () => void;
}) {
  /// 按帧序号存草稿：重做后帧 id 会换，序号不变，补充要求留着方便再改一次。
  const [drafts, setDrafts] = useState<Record<number, FrameDraft>>({});
  const updateDraft = (ordinal: number, patch: Partial<FrameDraft>) =>
    setDrafts((current) => ({ ...current, [ordinal]: { ...(current[ordinal] ?? EMPTY_DRAFT), ...patch } }));
  const approved = run.status === "APPROVED";
  const ready = run.status === "AWAITING_APPROVAL";
  const generatedCount = run.frames.filter((frame) => frame.status === "SUCCEEDED").length;
  const expectedCount = storyboardFrameTarget(run.durationSec);

  return (
    <section
      className="scroll-mt-24 space-y-3"
      aria-labelledby="storyboard-heading"
      data-testid="storyboard-workflow-panel"
    >
      <header className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 id="storyboard-heading" className="text-subhead font-medium">
              {english ? "Review your storyboard" : "确认视频故事板"}
            </h2>
            <span className="rounded-(--radius-sm) border border-border px-1.5 py-px font-mono text-data text-muted-foreground">
              {english ? "AI storyboard" : "AI 故事板"}
            </span>
            <span
              className={cn(
                "font-mono text-data tabular-nums",
                approved ? "text-success" : generatedCount < expectedCount ? "text-accent" : "text-foreground",
              )}
            >
              {generatedCount}/{expectedCount}
            </span>
          </div>
          <p className="max-w-[62ch] text-meta text-muted-foreground">
            {approved
              ? english
                ? "Locked for video generation. These frames keep product identity and scene continuity stable."
                : "已锁定用于视频生成；以下画面会约束产品外观与场景连续性。"
              : english
                ? `${generatedCount}/${expectedCount} keyframes ready. Review every frame before video generation.`
                : `关键帧已完成 ${generatedCount}/${expectedCount}。确认每一帧后才会进入视频生成。`}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" onClick={onEditPlan} disabled={approving || Boolean(busyFrameId)}>
          {english ? "Edit direction" : "修改创作方向"}
        </Button>
      </header>

      {/* 关键帧是一面接缝墙：一帧一格，正在绘制的那一格带生成光束 */}
      <div
        className={cn("x-wall grid-cols-2", expectedCount === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}
        data-testid="storyboard-frame-grid"
      >
        {Array.from({ length: expectedCount }, (_, ordinal) => {
          const frame = run.frames.find((item) => item.ordinal === ordinal);
          const pending = !frame || frame.status === "QUEUED" || frame.status === "PROCESSING";
          const failed = frame?.status === "FAILED";
          const regenerating = frame?.id === busyFrameId;
          const regenBlocked = failed && frame?.canRegenerate === false;
          const regenDisabled = !frame || pending || approved || regenerating || regenBlocked;
          const draft = drafts[ordinal] ?? EMPTY_DRAFT;
          const drawing = regenerating || (pending && run.status === "GENERATING");
          const frameState: VocabState<"frame"> = frame?.status === "SUCCEEDED"
            ? "done"
            : regenBlocked
              ? "held"
              : failed
                ? "failed"
                : drawing
                  ? "generating"
                  : "queued";
          return (
            <article key={frame?.id ?? ordinal} className={cn("flex min-w-0 flex-col", drawing && "x-beam")}>
              <div
                className={cn(
                  "relative w-full overflow-hidden bg-sunken",
                  run.aspectRatio === "9:16"
                    ? "aspect-[9/16] max-h-[28rem]"
                    : run.aspectRatio === "16:9"
                      ? "aspect-video"
                      : "aspect-square",
                )}
              >
                {frame?.imageUrl ? (
                  <Image
                    src={frame.imageUrl}
                    alt={english ? `Storyboard frame ${ordinal + 1}` : `故事板第 ${ordinal + 1} 帧`}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-contain"
                    unoptimized
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
                    {pending || regenerating ? (
                      <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
                    ) : (
                      <ImageIcon className="size-5" aria-hidden />
                    )}
                    <span className="text-meta">
                      {failed
                        ? frame.errorMessage ?? (english ? "Frame failed" : "此分镜生成失败")
                        : english
                          ? "Drawing this frame"
                          : "正在绘制此分镜"}
                    </span>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-(--radius-sm) bg-overlay px-1.5 py-0.5 font-mono text-micro tabular-nums text-foreground">
                  {String(ordinal + 1).padStart(2, "0")} · {frame?.attempt ? `v${frame.attempt}` : "…"}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-3">
                <div className="min-h-12 flex-1 space-y-1.5">
                  <p className="line-clamp-2 text-meta font-medium text-foreground">
                    {frame?.beat ? storyboardBeatLabel(frame.beat, english) : english ? "Preparing story beat" : "正在准备镜头节奏"}
                  </p>
                  <StatusTick entity="frame" state={frameState} locale={english ? "en-US" : "zh-CN"} />
                </div>
                {!approved ? (
                  <FrameRegenerateOptionsField
                    ordinal={ordinal}
                    english={english}
                    draft={draft}
                    referenceOptions={referenceOptions}
                    disabled={regenDisabled}
                    onChange={(patch) => updateDraft(ordinal, patch)}
                  />
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={regenDisabled}
                  title={regenBlocked
                    ? english
                      ? "This frame is locked until the provider confirms whether it was billed."
                      : "需等待合作方确认这一帧是否已计费，暂不能重做。"
                    : undefined}
                  onClick={() => frame && onRegenerate(frame.id, regenerateOptions(draft))}
                >
                  {regenerating ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw aria-hidden />}
                  {regenBlocked
                    ? english ? "Awaiting verification" : "等待核对中"
                    : english ? "Regenerate frame" : "重做这一帧"}
                </Button>
              </div>
            </article>
          );
        })}
        {/* 窄屏两列时 5 帧会空出一格：补一格同色面板，接缝墙不露底 */}
        {expectedCount % 2 === 1 ? <div aria-hidden className="lg:hidden" /> : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-meta text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          {english
            ? "Product images are used directly as consistency references. No AI upload review is required."
            : "产品图会直接作为一致性参考；上传阶段不经过 AI 审核。"}
        </p>
        {approved ? (
          <span className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-(--radius-md) border border-success px-3 text-meta font-medium text-success">
            <Check className="size-4" aria-hidden />
            {english ? "Storyboard approved" : "故事板已确认"}
          </span>
        ) : (
          <Button type="button" disabled={!ready || !run.canApprove || approving || Boolean(busyFrameId)} onClick={onApprove}>
            {approving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check aria-hidden />}
            {english ? "Approve all frames" : "确认全部分镜"}
          </Button>
        )}
      </div>
    </section>
  );
}

function regenerateOptions(draft: FrameDraft): StoryboardFrameRegenerateOptions {
  const promptOverride = draft.direction.trim();
  return {
    ...(promptOverride ? { promptOverride } : {}),
    ...(draft.assetIds.length > 0 ? { sourceAssetIds: draft.assetIds } : {}),
  };
}

/** 每帧折叠的「补充要求 + 参考图」：默认收起，不填就按原方案重抽。 */
function FrameRegenerateOptionsField({
  ordinal,
  english,
  draft,
  referenceOptions,
  disabled,
  onChange,
}: {
  ordinal: number;
  english: boolean;
  draft: FrameDraft;
  referenceOptions: StoryboardReferenceOption[];
  disabled: boolean;
  onChange: (patch: Partial<FrameDraft>) => void;
}) {
  const panelId = `storyboard-frame-${ordinal}-regenerate-options`;
  const filled = draft.direction.trim().length > 0 || draft.assetIds.length > 0;
  const atLimit = draft.assetIds.length >= STORYBOARD_FRAME_SOURCE_ASSETS_MAX;
  const toggleAsset = (assetId: string) =>
    onChange({
      assetIds: draft.assetIds.includes(assetId)
        ? draft.assetIds.filter((id) => id !== assetId)
        : [...draft.assetIds, assetId].slice(0, STORYBOARD_FRAME_SOURCE_ASSETS_MAX),
    });
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={draft.open}
        aria-controls={panelId}
        onClick={() => onChange({ open: !draft.open })}
        className="inline-flex items-center gap-1.5 text-meta text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        <ChevronDown className={cn("size-3.5 transition-transform duration-fast motion-reduce:transition-none", draft.open && "rotate-180")} aria-hidden />
        {english ? "Adjust before regenerating" : "重做前补充要求"}
        {filled ? (
          <>
            <span aria-hidden className="size-1.5 rounded-(--radius-sm) bg-accent" />
            <span className="sr-only">{english ? "(filled in)" : "（已填写）"}</span>
          </>
        ) : null}
      </button>
      {draft.open ? (
        <div id={panelId} className="space-y-2.5">
          <div className="space-y-1">
            <Textarea
              value={draft.direction}
              maxLength={STORYBOARD_FRAME_DIRECTION_MAX}
              rows={3}
              disabled={disabled}
              aria-label={english ? `Direction for frame ${ordinal + 1}` : `第 ${ordinal + 1} 帧的补充要求`}
              placeholder={english ? "Optional, e.g. closer shot showing the zipper" : "可选，例如：镜头再近一点，露出拉链细节"}
              className="min-h-20 text-meta"
              onChange={(event) => onChange({ direction: event.target.value })}
            />
            <p className="text-right font-mono text-micro tabular-nums text-tertiary">
              {draft.direction.length}/{STORYBOARD_FRAME_DIRECTION_MAX}
            </p>
          </div>
          {referenceOptions.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-micro text-muted-foreground">
                {english
                  ? `Reference photos · up to ${STORYBOARD_FRAME_SOURCE_ASSETS_MAX}; none selected keeps all product photos`
                  : `参考图 · 最多 ${STORYBOARD_FRAME_SOURCE_ASSETS_MAX} 张；不选则沿用全部产品图`}
              </p>
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={english ? "Reference photos" : "参考图"}>
                {referenceOptions.map((option) => {
                  const pressed = draft.assetIds.includes(option.assetId);
                  return (
                    <button
                      key={option.assetId}
                      type="button"
                      aria-pressed={pressed}
                      aria-label={option.label}
                      title={option.label}
                      disabled={disabled || (!pressed && atLimit)}
                      onClick={() => toggleAsset(option.assetId)}
                      className={cn(
                        "relative aspect-square overflow-hidden rounded-(--radius-sm) border bg-sunken transition-colors duration-fast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 motion-reduce:transition-none",
                        pressed ? "border-(--accent-line) bg-active" : "border-border hover:border-border-strong",
                      )}
                    >
                      <Image src={option.url} alt="" fill sizes="64px" className="object-cover" unoptimized />
                      {pressed ? (
                        <span className="absolute right-0.5 top-0.5 inline-flex size-4 items-center justify-center rounded-(--radius-sm) bg-overlay text-accent">
                          <Check className="size-3" aria-hidden />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
