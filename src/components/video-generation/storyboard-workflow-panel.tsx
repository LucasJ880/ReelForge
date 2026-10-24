"use client";

import Image from "next/image";
import {
  Check,
  ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { StatusTick, type TickTone } from "@/components/exchange/status-tick";
import { Button } from "@/components/ui/button";
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

export function StoryboardWorkflowPanel({
  run,
  english,
  busyFrameId,
  approving,
  onRegenerate,
  onApprove,
  onEditPlan,
}: {
  run: StoryboardRunView;
  english: boolean;
  busyFrameId: string | null;
  approving: boolean;
  onRegenerate: (frameId: string) => void;
  onApprove: () => void;
  onEditPlan: () => void;
}) {
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
              Image 2
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
          const drawing = regenerating || (pending && run.status === "GENERATING");
          const tone: TickTone = frame?.status === "SUCCEEDED"
            ? "filled"
            : failed && !regenBlocked
              ? "fault"
              : drawing
                ? "live"
                : "idle";
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
                          ? "Image 2 is drawing this frame"
                          : "Image 2 正在绘制此分镜"}
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
                    {frame?.beat ?? (english ? "Preparing story beat" : "正在准备镜头节奏")}
                  </p>
                  <StatusTick
                    tone={tone}
                    label={frame?.status === "SUCCEEDED"
                      ? english ? "Ready" : "画面已就绪"
                      : regenBlocked
                        ? english ? "Pending billing verification" : "等待计费核对"
                        : failed
                          ? english ? "Needs attention" : "需要处理"
                          : english ? "Generating" : "生成中"}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!frame || pending || approved || regenerating || regenBlocked}
                  title={regenBlocked
                    ? english
                      ? "This frame is locked until the provider confirms whether it was billed."
                      : "需等待合作方确认这一帧是否已计费，暂不能重做。"
                    : undefined}
                  onClick={() => frame && onRegenerate(frame.id)}
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
