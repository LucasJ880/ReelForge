"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2,
  Download,
  Loader2,
  PauseCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { KpiCard } from "@/components/editorial/kpi-card";
import { BatchFilmStrip } from "@/components/batch/batch-film-strip";
import { toast } from "sonner";
import { useTranslation } from "@/i18n";
import { getPlatformCopy } from "@/i18n/platform-copy";
import type { CustomerGenerationError } from "@/lib/api/customer-generation-error";
import type { CustomerRecoveryAction } from "@/lib/contracts/customer-api";
import { dispatchRecoveryHint } from "@/lib/api/customer-video-dispatch-recovery";

export interface BatchMonitorJob {
  id: string;
  batchIndex: number | null;
  status:
    | "QUEUED"
    | "PAUSED"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED";
  assignedAssets: unknown;
  outputVideoUrl: string | null;
  outputThumbUrl: string | null;
  lastProgress: number | null;
  userSafeError: string | null;
  error: CustomerGenerationError | null;
  retryCount: number;
  storyboard: {
    id: string;
    status: "GENERATING" | "AWAITING_APPROVAL" | "APPROVED" | "FAILED";
    approvalPolicy: "AUTO" | "MANUAL";
    frames: Array<{
      id: string;
      ordinal: number;
      status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
      imageUrl: string | null;
    }>;
  } | null;
}

export interface BatchMonitorData {
  id: string;
  status:
    | "EXPANDING"
    | "RUNNING"
    | "PAUSED"
    | "COMPLETED"
    | "PARTIAL_FAILED"
    | "FAILED"
    | "CANCELLED";
  requestedCount: number;
  queuedCount: number;
  pausedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  statusReason: string | null;
  template: {
    name: string;
    nameZh: string;
    version: number;
  };
  videoJobs: BatchMonitorJob[];
}

const TERMINAL_BATCH = new Set([
  "COMPLETED",
  "PARTIAL_FAILED",
  "FAILED",
  "CANCELLED",
]);

function firstAssetUrl(value: unknown): string | null {
  const assignment = value as
    | { assets?: Array<{ url?: unknown }> }
    | null
    | undefined;
  const url = assignment?.assets?.[0]?.url;
  return typeof url === "string" ? url : null;
}

type StatusVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning";

function jobStatusVariant(
  status: BatchMonitorJob["status"],
): StatusVariant {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "destructive";
  if (status === "RUNNING") return "default";
  if (status === "PAUSED") return "warning";
  return "secondary";
}

function batchStatusVariant(
  status: BatchMonitorData["status"],
): StatusVariant {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "CANCELLED") return "destructive";
  if (status === "PAUSED" || status === "PARTIAL_FAILED") return "warning";
  if (status === "RUNNING") return "default";
  return "secondary";
}

type BatchFailureCopy = ReturnType<
  typeof getPlatformCopy
>["batches"]["monitor"]["failures"];

function jobFailureSummary(
  job: BatchMonitorJob,
  copy: BatchFailureCopy,
): string {
  switch (job.error?.code) {
    case "ASSET_MISSING":
      return copy.assetMissing;
    case "PROVIDER_TIMEOUT":
      return copy.providerTimeout;
    case "SUBMISSION_ACK_UNKNOWN":
      return copy.acknowledgementUnknown;
    default:
      return copy.providerError;
  }
}

export function BatchMonitor({
  initialBatch,
}: {
  initialBatch: BatchMonitorData;
}) {
  const { locale } = useTranslation();
  const english = locale === "en-US";
  const batchCopy = getPlatformCopy(locale).batches;
  const monitorCopy = batchCopy.monitor;
  const jobLabels = monitorCopy.jobStatuses;
  const batchLabels = batchCopy.statuses;
  const [batch, setBatch] = useState(initialBatch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] =
    useState<CustomerRecoveryAction | null>(null);
  const [detailJob, setDetailJob] = useState<BatchMonitorJob | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/batches/${initialBatch.id}/status`, {
      method: "POST",
    });
    const data = (await response.json()) as {
      batch?: BatchMonitorData;
      error?: string;
    };
    if (!response.ok || !data.batch) {
      const failure = data as typeof data & { action?: CustomerRecoveryAction };
      setErrorAction(failure.action ?? "retry");
      throw new Error(monitorCopy.refreshFailed);
    }
    setBatch(data.batch);
  }, [initialBatch.id, monitorCopy.refreshFailed]);

  // INV-B7：整页唯一轮询器。所有卡片仅消费 batch.videoJobs，不自行 fetch。
  useEffect(() => {
    if (TERMINAL_BATCH.has(batch.status)) return;
    const timer = window.setInterval(() => {
      void refresh().catch((reason) => setError((reason as Error).message));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [batch.status, refresh]);

  const virtualizer = useVirtualizer({
    count: batch.videoJobs.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 57,
    overscan: 2,
  });
  const completedJobs = useMemo(
    () =>
      batch.videoJobs.filter(
        (job) => job.status === "SUCCEEDED" && job.outputVideoUrl,
      ),
    [batch.videoJobs],
  );
  const retryableFailedJobs = useMemo(
    () =>
      batch.videoJobs.filter(
        (job) => job.status === "FAILED" && job.error?.retryable === true,
      ),
    [batch.videoJobs],
  );
  const totalProgress = useMemo(() => {
    const runningProgress = batch.videoJobs
      .filter((job) => job.status === "RUNNING")
      .reduce((sum, job) => sum + (job.lastProgress ?? 0) / 100, 0);
    const finished =
      batch.completedCount + batch.failedCount + batch.cancelledCount;
    return Math.min(
      100,
      Math.round(((finished + runningProgress) / batch.requestedCount) * 100),
    );
  }, [batch]);

  async function action(key: string, url: string) {
    setBusy(key);
    setError(null);
    setErrorAction(null);
    try {
      const response = await fetch(url, { method: "POST" });
      const data = (await response.json()) as {
        batch?: BatchMonitorData;
        error?: string;
        action?: CustomerRecoveryAction;
      };
      if (!response.ok || !data.batch) {
        setErrorAction(data.action ?? "retry");
        throw new Error(monitorCopy.actionFailed);
      }
      setBatch(data.batch);
      toast.success(monitorCopy.statusUpdated);
    } catch (reason) {
      const message = (reason as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  function toggleAllCompleted() {
    if (
      completedJobs.length > 0 &&
      completedJobs.every((job) => selected.has(job.id))
    ) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(completedJobs.map((job) => job.id)));
  }

  function downloadSelected() {
    for (const job of completedJobs.filter((item) => selected.has(item.id))) {
      const anchor = document.createElement("a");
      anchor.href = job.outputVideoUrl!;
      anchor.download = `aivora-batch-${batch.id}-${(job.batchIndex ?? 0) + 1}.mp4`;
      anchor.rel = "noopener";
      anchor.click();
    }
  }

  return (
    <div
      className="min-w-0 space-y-8 [&_svg]:stroke-[1.5]"
      data-batch-poll-connections="1"
      data-batch-poll-endpoint={`/api/batches/${batch.id}/status`}
    >
      {error && (
        <Card size="sm" role="alert" className="border-danger">
          <CardContent className="space-y-1 text-meta text-danger">
            <p>{error}</p>
            {errorAction ? (
              <p className="text-foreground">
                {dispatchRecoveryHint(
                  errorAction,
                  english ? "en-US" : "zh-CN",
                )}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-5">
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="studio-label text-muted-foreground">
                  {monitorCopy.kicker}
                </p>
                <Badge variant={batchStatusVariant(batch.status)}>
                  {batchLabels[batch.status]}
                </Badge>
              </div>
              <div className="space-y-2">
                <h1 className="editorial-display wrap-break-word">
                  {english ? batch.template.name : batch.template.nameZh}
                </h1>
                <CardDescription className="break-all font-mono tabular-nums">
                  {monitorCopy.batch} {batch.id} · {monitorCopy.templateVersion} v{batch.template.version}
                </CardDescription>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {retryableFailedJobs.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy != null}
                  onClick={() =>
                    void action(
                      "retry-all",
                      `/api/batches/${batch.id}/retry`,
                    )
                  }
                >
                  {busy === "retry-all" ? (
                    <Loader2
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                  ) : (
                    <RefreshCw aria-hidden />
                  )}
                  {monitorCopy.retryRecoverable} ({retryableFailedJobs.length})
                </Button>
              )}
              {batch.queuedCount + batch.pausedCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy != null}
                  onClick={() =>
                    void action(
                      "cancel",
                      `/api/batches/${batch.id}/cancel`,
                    )
                  }
                >
                  {monitorCopy.cancelUnstarted}
                </Button>
              )}
            </div>
          </div>

          {batch.status === "PAUSED" && (
            <div className="flex items-start gap-3 border-l-2 border-warning pl-4 text-meta text-foreground">
              <PauseCircle
                className="mt-0.5 size-4 shrink-0 text-warning"
                aria-hidden
              />
              <span>{monitorCopy.paused.replace("{count}", String(batch.pausedCount))}</span>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label={monitorCopy.total} value={batch.requestedCount} />
            <KpiCard label={monitorCopy.completed} value={batch.completedCount} />
            <KpiCard label={monitorCopy.running} value={batch.runningCount} />
            <KpiCard
              label={monitorCopy.queuedPaused}
              value={batch.queuedCount + batch.pausedCount}
            />
            <KpiCard label={monitorCopy.failed} value={batch.failedCount} />
          </div>
          <KpiCard
            label={monitorCopy.progress}
            value={`${totalProgress}%`}
            progress={totalProgress}
          />
          <BatchFilmStrip
            locale={locale}
            counts={{
              completed: batch.completedCount,
              generating: batch.runningCount,
              queued: batch.queuedCount + batch.pausedCount,
              failed: batch.failedCount,
              cancelled: batch.cancelledCount,
            }}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-meta text-muted-foreground">
          {monitorCopy.virtualized} · {monitorCopy.currently} <span className="font-mono tabular-nums">{batch.videoJobs.length}</span> {monitorCopy.items}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleAllCompleted}
          >
            {completedJobs.every((job) => selected.has(job.id)) &&
            completedJobs.length > 0
              ? monitorCopy.clearSelection
              : monitorCopy.selectCompleted}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selected.size === 0}
            onClick={downloadSelected}
          >
            <Download aria-hidden />
            {monitorCopy.downloadSelected} ({selected.size})
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        role="region"
        aria-label={monitorCopy.jobsLabel}
        tabIndex={0}
        className="h-[min(720px,70vh)] min-w-0 overflow-auto rounded-(--radius-lg) border border-border bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        data-virtualized="true"
        data-total-cards={batch.videoJobs.length}
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const job = batch.videoJobs[virtualRow.index];
            const storyboardCover = job.storyboard?.frames.find(
              (frame) => frame.imageUrl,
            )?.imageUrl;
            const thumb = job.outputThumbUrl ?? storyboardCover ?? firstAssetUrl(job.assignedAssets);
            const checked = selected.has(job.id);
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                data-batch-video-card
                className="absolute left-0 top-0 flex h-14 w-full min-w-[680px] items-center gap-3 border-b border-border px-3 hover:bg-secondary"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <label className="flex size-5 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    disabled={job.status !== "SUCCEEDED"}
                    checked={checked}
                    onChange={() => setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(job.id)) next.delete(job.id);
                      else next.add(job.id);
                      return next;
                    })}
                    className="size-4 accent-primary"
                    aria-label={english ? `Select video ${(job.batchIndex ?? 0) + 1}` : `选择视频 ${(job.batchIndex ?? 0) + 1}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setDetailJob(job)}
                  onMouseEnter={(event) => {
                    const video = event.currentTarget.querySelector("video");
                    if (video) void video.play().catch(() => undefined);
                  }}
                  onMouseLeave={(event) => {
                    const video = event.currentTarget.querySelector("video");
                    if (video) {
                      video.pause();
                      video.currentTime = 0;
                    }
                  }}
                  className="relative flex h-[54px] w-24 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-sm) bg-secondary font-mono text-meta text-muted-foreground"
                  aria-label={english ? `View video ${(job.batchIndex ?? 0) + 1}` : `查看视频 ${(job.batchIndex ?? 0) + 1} 详情`}
                >
                  {job.status === "SUCCEEDED" && job.outputVideoUrl ? (
                    <><video
                        src={job.outputVideoUrl}
                        poster={thumb ?? undefined}
                        muted
                        playsInline
                        preload="metadata"
                        className="pointer-events-none size-full object-cover"
                      /><AiGeneratedLabel compact className="pointer-events-none absolute bottom-1 left-1 px-1 py-0.5" /></>
                  ) : thumb ? (
                    <Image src={thumb} alt="" fill unoptimized sizes="96px" className="object-cover" />
                  ) : (
                    `#${(job.batchIndex ?? 0) + 1}`
                  )}
                </button>
                <div className="w-40 min-w-0 shrink-0">
                  <p className="truncate font-mono text-meta font-semibold text-foreground">{monitorCopy.video} #{(job.batchIndex ?? 0) + 1}</p>
                  <p className="truncate font-mono text-meta text-muted-foreground" title={job.id}>{job.id}</p>
                </div>
                <Badge variant={jobStatusVariant(job.status)} className="w-20">{jobLabels[job.status]}</Badge>
                <div className="min-w-32 flex-1">
                  {job.status === "RUNNING" ? <Progress value={job.lastProgress ?? 8} aria-label={english ? `Video ${(job.batchIndex ?? 0) + 1} progress ${job.lastProgress ?? 8}%` : `视频 ${(job.batchIndex ?? 0) + 1} 生成进度 ${job.lastProgress ?? 8}%`} /> : null}
                  {job.status === "FAILED" ? <p className="truncate text-meta text-danger">{jobFailureSummary(job, monitorCopy.failures)}</p> : null}
                  {job.status === "SUCCEEDED" ? <p className="flex items-center gap-1.5 text-meta text-success"><CheckCircle2 className="size-3" aria-hidden />{monitorCopy.ready}</p> : null}
                  {job.status === "CANCELLED" ? <p className="flex items-center gap-1.5 text-meta text-muted-foreground"><XCircle className="size-3" aria-hidden />{monitorCopy.cancelled}</p> : null}
                  {job.status === "QUEUED" ? (
                    <p className="truncate text-meta text-muted-foreground">
                      {job.storyboard?.status === "APPROVED"
                        ? (english ? "Storyboard locked · waiting for Shuyu video" : "故事板已锁定 · 等待 Shuyu 视频")
                        : job.storyboard
                          ? (english ? `Image 2 storyboard · ${job.storyboard.frames.filter((frame) => frame.status === "SUCCEEDED").length}/4` : `Image 2 故事板 · ${job.storyboard.frames.filter((frame) => frame.status === "SUCCEEDED").length}/4`)
                          : (english ? "Waiting for Image 2 storyboard" : "等待 Image 2 故事板")}
                    </p>
                  ) : null}
                </div>
                <p className="w-14 shrink-0 text-right font-mono text-meta tabular-nums text-muted-foreground">{job.retryCount} {monitorCopy.retryCount}</p>
                {job.status === "FAILED" && job.error?.retryable ? (
                  <Button type="button" variant="outline" size="xs" disabled={busy != null} onClick={() => void action(`retry-${job.id}`, `/api/batches/${batch.id}/jobs/${job.id}/retry`)}>
                    {busy === `retry-${job.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw aria-hidden />}{monitorCopy.retry}
                  </Button>
                ) : job.status === "FAILED" && job.error ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setDetailJob(job)}
                  >
                    {monitorCopy.nextStep}
                  </Button>
                ) : <span className="w-[72px]" aria-hidden />}
              </div>
            );
          })}
        </div>
      </div>

      <Sheet
        open={detailJob != null}
        onOpenChange={(open) => {
          if (!open) setDetailJob(null);
        }}
      >
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
          {detailJob ? (
            <>
              <SheetHeader>
                <SheetTitle>{monitorCopy.video} #{(detailJob.batchIndex ?? 0) + 1}</SheetTitle>
                <SheetDescription>
                  {jobLabels[detailJob.status]}
                  {detailJob.status === "FAILED"
                    ? ` · ${jobFailureSummary(detailJob, monitorCopy.failures)}`
                    : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="mx-auto w-full max-w-5xl space-y-5 px-6 pb-6">
                <ol className="grid gap-2 text-meta sm:grid-cols-4" aria-label={english ? "Video workflow" : "视频工作流"}>
                  {[
                    english ? "1 · Product uploaded" : "1 · 产品图已上传",
                    english ? "2 · Image 2 storyboard" : "2 · Image 2 故事板",
                    english ? "3 · Shuyu video" : "3 · Shuyu 视频生成",
                    english ? "4 · Delivery" : "4 · 成片交付",
                  ].map((label, index) => (
                    <li key={label} className="rounded-(--radius-sm) border border-border bg-card px-3 py-2">
                      <span className={index === 0 || detailJob.storyboard?.status === "APPROVED" || (index > 1 && detailJob.status === "SUCCEEDED") ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                    </li>
                  ))}
                </ol>
                <section className="space-y-3" aria-labelledby="batch-storyboard-title">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 id="batch-storyboard-title" className="font-medium text-foreground">
                        {english ? "Consistency storyboard" : "一致性故事板"}
                      </h3>
                      <p className="text-meta text-muted-foreground">
                        {english ? "Four Image 2 frames are auto-approved for this batch item before video generation." : "该条任务先由 Image 2 生成 4 帧并自动确认，再进入视频生成。"}
                      </p>
                    </div>
                    <Badge variant={detailJob.storyboard?.status === "APPROVED" ? "success" : detailJob.storyboard?.status === "FAILED" ? "destructive" : "secondary"}>
                      {detailJob.storyboard?.status === "APPROVED"
                        ? (english ? "Auto-approved" : "已自动确认")
                        : detailJob.storyboard?.status === "FAILED"
                          ? (english ? "Needs attention" : "需要处理")
                          : (english ? "Generating" : "生成中")}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {Array.from({ length: 4 }, (_, ordinal) => {
                      const frame = detailJob.storyboard?.frames.find((item) => item.ordinal === ordinal);
                      return (
                        <div key={frame?.id ?? ordinal} className="space-y-2">
                          <div className="relative aspect-9/16 overflow-hidden rounded-(--radius-sm) border border-border bg-secondary">
                            {frame?.imageUrl ? (
                              <Image src={frame.imageUrl} alt={english ? `Storyboard frame ${ordinal + 1}` : `故事板分镜 ${ordinal + 1}`} fill unoptimized sizes="(max-width: 640px) 45vw, 220px" className="object-contain" />
                            ) : (
                              <div className="flex size-full items-center justify-center text-meta text-muted-foreground">
                                {frame?.status === "FAILED" ? (english ? "Failed" : "失败") : (english ? "Generating…" : "生成中…")}
                              </div>
                            )}
                          </div>
                          <p className="font-mono text-meta text-muted-foreground">{english ? `Frame ${ordinal + 1}` : `分镜 ${ordinal + 1}`} · {frame?.status ?? "QUEUED"}</p>
                        </div>
                      );
                    })}
                  </div>
                </section>
                {detailJob.error ? (
                  <p className="rounded-(--radius-sm) border border-border p-3 text-meta text-foreground">
                    {dispatchRecoveryHint(
                      detailJob.error.action,
                      english ? "en-US" : "zh-CN",
                    )}
                  </p>
                ) : null}
                {detailJob.outputVideoUrl ? (
                  <div className="relative flex justify-center rounded-(--radius-md) bg-secondary/40 p-3"><video
                      src={detailJob.outputVideoUrl}
                      poster={detailJob.outputThumbUrl ?? undefined}
                      controls
                      preload="metadata"
                      className="max-h-[min(58vh,720px)] w-auto max-w-full rounded-(--radius-md) border border-border object-contain"
                    /><AiGeneratedLabel className="pointer-events-none absolute left-3 top-3" /></div>
                ) : null}
                {detailJob.status === "RUNNING" && (
                  <Progress
                    value={detailJob.lastProgress ?? 8}
                    aria-label={english ? `Video ${(detailJob.batchIndex ?? 0) + 1} progress` : `视频 ${(detailJob.batchIndex ?? 0) + 1} 生成进度`}
                  />
                )}
                {detailJob.status === "FAILED" && detailJob.error?.retryable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy != null}
                    onClick={() =>
                      void action(
                        `retry-${detailJob.id}`,
                        `/api/batches/${batch.id}/jobs/${detailJob.id}/retry`,
                      )
                    }
                  >
                    <RefreshCw aria-hidden />
                    {monitorCopy.retryVideo}
                  </Button>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
