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

function firstAssetUrl(value: unknown): string | null {
  const assignment = value as
    | { assets?: Array<{ url?: unknown }> }
    | null
    | undefined;
  const url = assignment?.assets?.[0]?.url;
  return typeof url === "string" ? url : null;
}

function statusTone(status: BatchMonitorJob["status"]): string {
  if (status === "SUCCEEDED") return "bg-emerald-500/15 text-emerald-200";
  if (status === "FAILED") return "bg-red-500/15 text-red-200";
  if (status === "RUNNING") return "bg-violet-500/15 text-violet-200";
  if (status === "PAUSED") return "bg-amber-500/15 text-amber-200";
  return "bg-white/10 text-white/60";
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
      className="space-y-6"
      data-batch-poll-connections="1"
      data-batch-poll-endpoint={`/api/batches/${batch.id}/status`}
    >
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100"
        >
          {error}
        </div>
      )}

      <section className="glass-card space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-white">
                {batch.template.nameZh}
              </h1>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/45">
                v{batch.template.version}
              </span>
            </div>
            <p className="mt-1 text-xs text-white/45">批次 {batch.id}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {batch.failedCount > 0 && (
              <button
                type="button"
                disabled={busy != null}
                onClick={() =>
                  void action(
                    "retry-all",
                    `/api/batches/${batch.id}/retry`,
                  )
                }
                className="glass-btn inline-flex items-center gap-1.5 text-xs"
              >
                {busy === "retry-all" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                重试全部失败 ({batch.failedCount})
              </button>
            )}
            {batch.queuedCount + batch.pausedCount > 0 && (
              <button
                type="button"
                disabled={busy != null}
                onClick={() =>
                  void action(
                    "cancel",
                    `/api/batches/${batch.id}/cancel`,
                  )
                }
                className="glass-btn text-xs"
              >
                取消未开始
              </button>
            )}
          </div>
        </div>

        {batch.status === "PAUSED" && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">
            <PauseCircle className="mt-0.5 size-4 shrink-0" />
            <span>
              生成服务暂时拥堵，剩余 {batch.pausedCount} 条已安全暂停。
              熔断恢复后会自动续跑。{batch.statusReason}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["总数", batch.requestedCount, "text-white"],
            ["完成", batch.completedCount, "text-emerald-300"],
            ["进行中", batch.runningCount, "text-violet-300"],
            ["排队/暂停", batch.queuedCount + batch.pausedCount, "text-amber-200"],
            ["失败", batch.failedCount, "text-red-300"],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-xl bg-white/4 p-3">
              <p className="text-[11px] text-white/45">{label}</p>
              <p className={`mt-1 text-xl font-semibold ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-2 flex justify-between text-xs text-white/50">
            <span>总进度</span>
            <span>{totalProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-linear-to-r from-violet-500 to-emerald-400 transition-[width]"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-white/45">
          虚拟网格仅渲染可视区域 · 当前 {batch.videoJobs.length} 条
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleAllCompleted}
            className="glass-btn text-xs"
          >
            {completedJobs.every((job) => selected.has(job.id)) &&
            completedJobs.length > 0
              ? "取消全选"
              : "全选已完成"}
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={downloadSelected}
            className="glass-btn-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-40"
          >
            <Download className="size-3.5" />
            下载所选 ({selected.size})
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="h-[720px] overflow-auto rounded-2xl border border-white/10 bg-black/20 p-2"
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
                className="absolute left-0 top-0 grid w-full gap-3 pb-3"
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
                    <article
                      key={job.id}
                      className="overflow-hidden rounded-xl border border-white/10 bg-white/4"
                      data-batch-video-card
                    >
                      <div className="relative aspect-9/12 bg-black/40">
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
                            <PlayCircle className="size-8 text-white/20" />
                          </div>
                        )}
                        <label className="absolute left-2 top-2">
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
                            className="size-4 accent-violet-500"
                            aria-label={`选择视频 ${(job.batchIndex ?? 0) + 1}`}
                          />
                        </label>
                      </div>
                      <div className="space-y-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-white">
                            视频 #{(job.batchIndex ?? 0) + 1}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] ${statusTone(job.status)}`}
                          >
                            {JOB_LABELS[job.status]}
                          </span>
                        </div>
                        {job.status === "RUNNING" && (
                          <div className="h-1 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full bg-violet-400"
                              style={{ width: `${job.lastProgress ?? 8}%` }}
                            />
                          </div>
                        )}
                        {job.status === "FAILED" && (
                          <div className="space-y-2">
                            <p
                              className="line-clamp-2 text-[11px] text-red-200/75"
                              title={job.errorMessage ?? undefined}
                            >
                              {job.userSafeError ?? "生成失败，可重试"}
                            </p>
                            <button
                              type="button"
                              disabled={busy != null}
                              onClick={() =>
                                void action(
                                  `retry-${job.id}`,
                                  `/api/batches/${batch.id}/jobs/${job.id}/retry`,
                                )
                              }
                              className="inline-flex items-center gap-1 text-[11px] text-violet-200 hover:text-white"
                            >
                              {busy === `retry-${job.id}` ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3" />
                              )}
                              单条重试
                            </button>
                          </div>
                        )}
                        {job.status === "SUCCEEDED" && (
                          <p className="flex items-center gap-1 text-[11px] text-emerald-300/75">
                            <CheckCircle2 className="size-3" /> 可播放与下载
                          </p>
                        )}
                        {job.status === "CANCELLED" && (
                          <p className="flex items-center gap-1 text-[11px] text-white/40">
                            <XCircle className="size-3" /> 未提交 Provider
                          </p>
                        )}
                      </div>
                    </article>
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
