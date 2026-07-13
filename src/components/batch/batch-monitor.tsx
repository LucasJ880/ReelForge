"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2,
  Download,
  Loader2,
  PauseCircle,
  PlayCircle,
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

const JOB_LABELS: Record<BatchMonitorJob["status"], string> = {
  QUEUED: "排队中",
  PAUSED: "已暂停",
  RUNNING: "生成中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

const BATCH_LABELS: Record<BatchMonitorData["status"], string> = {
  EXPANDING: "正在展开",
  RUNNING: "生成中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  PARTIAL_FAILED: "部分失败",
  FAILED: "失败",
  CANCELLED: "已取消",
};

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
  const [batch, setBatch] = useState(initialBatch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState(4);
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
      throw new Error(data.error ?? "批次状态刷新失败");
    }
    setBatch(data.batch);
  }, [initialBatch.id]);

  // INV-B7：整页唯一轮询器。所有卡片仅消费 batch.videoJobs，不自行 fetch。
  useEffect(() => {
    if (TERMINAL_BATCH.has(batch.status)) return;
    const timer = window.setInterval(() => {
      void refresh().catch((reason) => setError((reason as Error).message));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [batch.status, refresh]);

  useEffect(() => {
    const updateColumns = () => {
      const width = viewportRef.current?.clientWidth ?? window.innerWidth;
      setColumns(width >= 1100 ? 4 : width >= 720 ? 3 : width >= 480 ? 2 : 1);
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  const rowCount = Math.ceil(batch.videoJobs.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 320,
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
        throw new Error(data.error ?? "操作失败");
      }
      setBatch(data.batch);
    } catch (reason) {
      setError((reason as Error).message);
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
                <p className="text-meta font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Editorial Batch Monitor
                </p>
                <Badge variant={batchStatusVariant(batch.status)}>
                  {BATCH_LABELS[batch.status]}
                </Badge>
              </div>
              <div className="space-y-2">
                <h1 className="editorial-display wrap-break-word">
                  {batch.template.nameZh}
                </h1>
                <CardDescription className="break-all">
                  批次 {batch.id} · 模板版本 v{batch.template.version}
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
                  重试全部失败 ({batch.failedCount})
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
                  取消未开始
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
                生成服务暂时拥堵，剩余 {batch.pausedCount} 条已安全暂停。
                熔断恢复后会自动续跑。{batch.statusReason}
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          <dl className="grid grid-cols-2 border-y border-border sm:grid-cols-5">
            {[
              ["总数", batch.requestedCount],
              ["完成", batch.completedCount],
              ["进行中", batch.runningCount],
              ["排队/暂停", batch.queuedCount + batch.pausedCount],
              ["失败", batch.failedCount],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="min-w-0 border-b border-border py-3 last:border-b-0 sm:border-b-0"
              >
                <dt className="text-meta text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-heading text-subhead tabular-nums text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="space-y-2">
            <div className="flex justify-between gap-4 text-meta">
              <span className="font-medium text-foreground">总进度</span>
              <span className="tabular-nums text-muted-foreground">
                {totalProgress}%
              </span>
            </div>
            <Progress
              value={totalProgress}
              aria-label={`批次总进度 ${totalProgress}%`}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-meta text-muted-foreground">
          虚拟网格仅渲染可视区域 · 当前 {batch.videoJobs.length} 条
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
              ? "取消全选"
              : "全选已完成"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selected.size === 0}
            onClick={downloadSelected}
          >
            <Download aria-hidden />
            下载所选 ({selected.size})
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        role="region"
        aria-label="批次视频任务列表"
        tabIndex={0}
        className="h-[min(720px,70vh)] min-w-0 overflow-auto rounded-(--radius-lg) border border-border bg-muted p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-3"
        data-virtualized="true"
        data-total-cards={batch.videoJobs.length}
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowStart = virtualRow.index * columns;
            const jobs = batch.videoJobs.slice(rowStart, rowStart + columns);
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute left-0 top-0 grid w-full min-w-0 gap-3 pb-3"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {jobs.map((job) => {
                  const thumb =
                    job.outputThumbUrl ?? firstAssetUrl(job.assignedAssets);
                  const checked = selected.has(job.id);
                  return (
                    <Card
                      key={job.id}
                      size="sm"
                      className="min-w-0 gap-0 py-0"
                      data-batch-video-card
                    >
                      <div className="relative aspect-9/12 bg-muted">
                        {job.outputVideoUrl ? (
                          <video
                            src={job.outputVideoUrl}
                            poster={thumb ?? undefined}
                            controls
                            preload="metadata"
                            className="size-full object-cover"
                          />
                        ) : thumb ? (
                          <div
                            className="size-full bg-cover bg-center"
                            style={{ backgroundImage: `url("${thumb}")` }}
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <PlayCircle
                              className="size-8 text-muted-foreground"
                              aria-hidden
                            />
                          </div>
                        )}
                        <label className="absolute left-2 top-2 rounded-(--radius-sm) bg-card p-1">
                          <input
                            type="checkbox"
                            disabled={job.status !== "SUCCEEDED"}
                            checked={checked}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (next.has(job.id)) next.delete(job.id);
                                else next.add(job.id);
                                return next;
                              })
                            }
                            className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            aria-label={`选择视频 ${(job.batchIndex ?? 0) + 1}`}
                          />
                        </label>
                      </div>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-meta font-semibold text-foreground">
                            视频 #{(job.batchIndex ?? 0) + 1}
                          </span>
                          <Badge variant={jobStatusVariant(job.status)}>
                            {JOB_LABELS[job.status]}
                          </Badge>
                        </div>
                        {job.status === "RUNNING" && (
                          <Progress
                            value={job.lastProgress ?? 8}
                            aria-label={`视频 ${(job.batchIndex ?? 0) + 1} 生成进度 ${job.lastProgress ?? 8}%`}
                          />
                        )}
                        {job.status === "FAILED" && (
                          <div className="space-y-2">
                            <p
                              className="line-clamp-2 text-meta text-danger"
                              title={job.errorMessage ?? undefined}
                            >
                              {job.userSafeError ?? "生成失败，可重试"}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              disabled={busy != null}
                              onClick={() =>
                                void action(
                                  `retry-${job.id}`,
                                  `/api/batches/${batch.id}/jobs/${job.id}/retry`,
                                )
                              }
                            >
                              {busy === `retry-${job.id}` ? (
                                <Loader2
                                  className="animate-spin motion-reduce:animate-none"
                                  aria-hidden
                                />
                              ) : (
                                <RefreshCw aria-hidden />
                              )}
                              单条重试
                            </Button>
                          </div>
                        )}
                        {job.status === "SUCCEEDED" && (
                          <p className="flex items-center gap-1.5 text-meta text-success">
                            <CheckCircle2 className="size-3" aria-hidden />{" "}
                            可播放与下载
                          </p>
                        )}
                        {job.status === "CANCELLED" && (
                          <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
                            <XCircle className="size-3" aria-hidden /> 未提交
                            Provider
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
