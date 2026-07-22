"use client";

import Image from "next/image";
import {
  Check,
  ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
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
  const expectedCount = run.durationSec <= 15 ? 4 : 5;

  return (
    <section
      className="scroll-mt-20 overflow-hidden rounded-(--radius-lg) border border-border bg-card"
      aria-labelledby="storyboard-heading"
      data-testid="storyboard-workflow-panel"
    >
      <div className="flex flex-col gap-4 border-b border-border bg-muted px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary bg-accent-soft text-foreground">
            {approved ? <Check className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="storyboard-heading" className="font-heading text-title font-semibold">
                {english ? "Review your storyboard" : "确认视频故事板"}
              </h2>
              <span className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                Shuyu Image 2
              </span>
            </div>
            <p className="mt-1 text-meta text-muted-foreground">
              {approved
                ? english
                  ? "Locked for video generation. These frames keep product identity and scene continuity stable."
                  : "已锁定用于视频生成；以下画面会约束产品外观与场景连续性。"
                : english
                  ? `${generatedCount}/${expectedCount} keyframes ready. Review every frame before video generation.`
                  : `关键帧已完成 ${generatedCount}/${expectedCount}。确认每一帧后才会进入视频生成。`}
            </p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onEditPlan} disabled={approving || Boolean(busyFrameId)}>
          {english ? "Edit direction" : "修改创作方向"}
        </Button>
      </div>

      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="storyboard-frame-grid">
          {Array.from({ length: expectedCount }, (_, ordinal) => {
            const frame = run.frames.find((item) => item.ordinal === ordinal);
            const pending = !frame || frame.status === "QUEUED" || frame.status === "PROCESSING";
            const failed = frame?.status === "FAILED";
            const regenerating = frame?.id === busyFrameId;
            const regenBlocked = failed && frame?.canRegenerate === false;
            return (
              <article key={frame?.id ?? ordinal} className="min-w-0 overflow-hidden rounded-(--radius-md) border border-border bg-muted">
                <div
                  className={cn(
                    "relative w-full overflow-hidden bg-background",
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
                  <span className="absolute left-2 top-2 rounded-full border border-white/15 bg-black/70 px-2 py-1 font-mono text-[10px] text-white">
                    {String(ordinal + 1).padStart(2, "0")} · {frame?.attempt ? `v${frame.attempt}` : "…"}
                  </span>
                </div>
                <div className="space-y-3 p-3">
                  <div className="min-h-12">
                    <p className="line-clamp-2 text-meta font-medium text-foreground">
                      {frame?.beat ?? (english ? "Preparing story beat" : "正在准备镜头节奏")}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {frame?.status === "SUCCEEDED"
                        ? english ? "Ready" : "画面已就绪"
                        : regenBlocked
                          ? english ? "Pending billing verification" : "等待计费核对"
                          : failed
                            ? english ? "Needs attention" : "需要处理"
                            : english ? "Generating" : "生成中"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full bg-card"
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
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-(--radius-md) border border-border bg-muted p-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <p className="text-meta text-muted-foreground">
              {english
                ? "Product images are used directly as consistency references. No AI upload review is required."
                : "产品图会直接作为一致性参考；上传阶段不经过 AI 审核。"}
            </p>
          </div>
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
      </div>
    </section>
  );
}
