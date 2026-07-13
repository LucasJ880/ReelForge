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
  errorMessage: string | null;
  userSafeError: string | null;
  retryCount: number;
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

export function BatchMonitor({
  initialBatch,
}: {
  initialBatch: BatchMonitorData;
}) {
  const { locale } = useTranslation();
  const english = locale === "en-US";
  const jobLabels: Record<BatchMonitorJob["status"], string> = english
    ? { QUEUED: "Queued", PAUSED: "Paused", RUNNING: "Generating", SUCCEEDED: "Completed", FAILED: "Failed", CANCELLED: "Cancelled" }
    : { QUEUED: "排队中", PAUSED: "已暂停", RUNNING: "生成中", SUCCEEDED: "已完成", FAILED: "失败", CANCELLED: "已取消" };
  const batchLabels: Record<BatchMonitorData["status"], string> = english
    ? { EXPANDING: "Preparing", RUNNING: "Generating", PAUSED: "Paused", COMPLETED: "Completed", PARTIAL_FAILED: "Partially failed", FAILED: "Failed", CANCELLED: "Cancelled" }
    : { EXPANDING: "正在展开", RUNNING: "生成中", PAUSED: "已暂停", COMPLETED: "已完成", PARTIAL_FAILED: "部分失败", FAILED: "失败", CANCELLED: "已取消" };
  const [batch, setBatch] = useState(initialBatch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      throw new Error(data.error ?? (english ? "Failed to refresh batch status" : "批次状态刷新失败"));
    }
    setBatch(data.batch);
  }, [english, initialBatch.id]);

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
    try {
      const response = await fetch(url, { method: "POST" });
      const data = (await response.json()) as {
        batch?: BatchMonitorData;
        error?: string;
      };
      if (!response.ok || !data.batch) {
        throw new Error(data.error ?? (english ? "Action failed" : "操作失败"));
      }
      setBatch(data.batch);
      toast.success(english ? "Batch status updated" : "批次状态已更新");
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
          <CardContent className="text-meta text-danger">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-5">
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="studio-label text-muted-foreground">
                  Batch monitor
                </p>
                <Badge variant={batchStatusVariant(batch.status)}>
                  {batchLabels[batch.status]}
                </Badge>
              </div>
              <div className="space-y-2">
                <h1 className="editorial-display wrap-break-word">
                  {batch.template.nameZh}
                </h1>
                <CardDescription className="break-all font-mono tabular-nums">
                  {english ? "Batch" : "批次"} {batch.id} · {english ? "Template version" : "模板版本"} v{batch.template.version}
                </CardDescription>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {batch.failedCount > 0 && (
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
                  {english ? "Retry all failed" : "重试全部失败"} ({batch.failedCount})
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
                  {english ? "Cancel unstarted" : "取消未开始"}
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
              <span>
                {english
                  ? `Generation is temporarily congested. ${batch.pausedCount} items are safely paused and will resume when the circuit breaker recovers. `
                  : `生成服务暂时拥堵，剩余 ${batch.pausedCount} 条已安全暂停。熔断恢复后会自动续跑。`}
                {batch.statusReason}
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label={english ? "Total" : "总数"} value={batch.requestedCount} />
            <KpiCard label={english ? "Completed" : "完成"} value={batch.completedCount} />
            <KpiCard label={english ? "Running" : "进行中"} value={batch.runningCount} />
            <KpiCard
              label={english ? "Queued / paused" : "排队/暂停"}
              value={batch.queuedCount + batch.pausedCount}
            />
            <KpiCard label={english ? "Failed" : "失败"} value={batch.failedCount} />
          </div>
          <KpiCard
            label={english ? "Batch progress" : "批次总进度"}
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
          {english ? "Virtualized view renders only visible rows" : "虚拟列表仅渲染可视区域"} · {english ? "Currently" : "当前"} <span className="font-mono tabular-nums">{batch.videoJobs.length}</span> {english ? "items" : "条"}
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
              ? (english ? "Clear selection" : "取消全选")
              : (english ? "Select completed" : "全选已完成")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selected.size === 0}
            onClick={downloadSelected}
          >
            <Download aria-hidden />
            {english ? "Download selected" : "下载所选"} ({selected.size})
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        role="region"
        aria-label={english ? "Batch video jobs" : "批次视频任务列表"}
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
            const thumb = job.outputThumbUrl ?? firstAssetUrl(job.assignedAssets);
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
                  <p className="truncate font-mono text-meta font-semibold text-foreground">{english ? "Video" : "视频"} #{(job.batchIndex ?? 0) + 1}</p>
                  <p className="truncate font-mono text-meta text-muted-foreground" title={job.id}>{job.id}</p>
                </div>
                <Badge variant={jobStatusVariant(job.status)} className="w-20">{jobLabels[job.status]}</Badge>
                <div className="min-w-32 flex-1">
                  {job.status === "RUNNING" ? <Progress value={job.lastProgress ?? 8} aria-label={english ? `Video ${(job.batchIndex ?? 0) + 1} progress ${job.lastProgress ?? 8}%` : `视频 ${(job.batchIndex ?? 0) + 1} 生成进度 ${job.lastProgress ?? 8}%`} /> : null}
                  {job.status === "FAILED" ? <p className="truncate text-meta text-danger" title={job.errorMessage ?? undefined}>{job.userSafeError ?? (english ? "Generation failed; safe to retry" : "生成失败，可重试")}</p> : null}
                  {job.status === "SUCCEEDED" ? <p className="flex items-center gap-1.5 text-meta text-success"><CheckCircle2 className="size-3" aria-hidden />{english ? "Ready to play and download" : "可播放与下载"}</p> : null}
                  {job.status === "CANCELLED" ? <p className="flex items-center gap-1.5 text-meta text-muted-foreground"><XCircle className="size-3" aria-hidden />{english ? "Not submitted to provider" : "未提交 Provider"}</p> : null}
                </div>
                <p className="w-14 shrink-0 text-right font-mono text-meta tabular-nums text-muted-foreground">{job.retryCount} retry</p>
                {job.status === "FAILED" ? (
                  <Button type="button" variant="outline" size="xs" disabled={busy != null} onClick={() => void action(`retry-${job.id}`, `/api/batches/${batch.id}/jobs/${job.id}/retry`)}>
                    {busy === `retry-${job.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw aria-hidden />}{english ? "Retry" : "重试"}
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
        <SheetContent side="bottom" className="md:hidden">
          {detailJob ? (
            <>
              <SheetHeader>
                <SheetTitle>{english ? "Video" : "视频"} #{(detailJob.batchIndex ?? 0) + 1}</SheetTitle>
                <SheetDescription>
                  {jobLabels[detailJob.status]}
                  {detailJob.userSafeError ? ` · ${detailJob.userSafeError}` : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-6 pb-6">
                {detailJob.outputVideoUrl ? (
                  <div className="relative"><video
                      src={detailJob.outputVideoUrl}
                      poster={detailJob.outputThumbUrl ?? undefined}
                      controls
                      preload="metadata"
                      className="aspect-9/12 w-full rounded-(--radius-md) border border-border object-cover"
                    /><AiGeneratedLabel className="pointer-events-none absolute left-3 top-3" /></div>
                ) : null}
                {detailJob.status === "RUNNING" && (
                  <Progress
                    value={detailJob.lastProgress ?? 8}
                    aria-label={english ? `Video ${(detailJob.batchIndex ?? 0) + 1} progress` : `视频 ${(detailJob.batchIndex ?? 0) + 1} 生成进度`}
                  />
                )}
                {detailJob.status === "FAILED" && (
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
                    {english ? "Retry video" : "单条重试"}
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
