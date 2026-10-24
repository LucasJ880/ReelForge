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
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BatchFilmStrip } from "@/components/batch/batch-film-strip";
import { batchMonitorReadings } from "@/components/batch/batch-monitor-readings";
import { MonoTag } from "@/components/exchange/mono-tag";
import { QuoteHeader } from "@/components/exchange/quote-header";
import { StatusTick } from "@/components/exchange/status-tick";
import { batchState, stateWord, videoJobState, type VocabState } from "@/lib/exchange/state-vocab";
import { requestPulseRefresh } from "@/lib/exchange/pulse";
import { toast } from "sonner";
import { useTranslation } from "@/i18n";
import { getPlatformCopy } from "@/i18n/platform-copy";
import type { CustomerGenerationError } from "@/lib/api/customer-generation-error";
import type { CustomerRecoveryAction } from "@/lib/contracts/customer-api";
import { dispatchRecoveryHint } from "@/lib/api/customer-video-dispatch-recovery";
import { cn } from "@/lib/utils";

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
  productName?: string | null;
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

/** 故事板一帧的状态词：从状态词典取，不把 QUEUED / PROCESSING 原值摆给客户。 */
const FRAME_STATE: Record<"QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED", VocabState<"frame">> = {
  QUEUED: "queued",
  PROCESSING: "generating",
  SUCCEEDED: "done",
  FAILED: "failed",
};

function fillCopy(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

function firstAssetUrl(value: unknown): string | null {
  const assignment = value as
    | { assets?: Array<{ url?: unknown }> }
    | null
    | undefined;
  const url = assignment?.assets?.[0]?.url;
  return typeof url === "string" ? url : null;
}

type BatchFailureCopy = ReturnType<
  typeof getPlatformCopy
>["batches"]["monitor"]["failures"];

function jobFailureSummary(
  job: BatchMonitorJob,
  copy: BatchFailureCopy,
  english: boolean,
): string {
  if (!english && job.error?.message) return job.error.message;
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
  readOnly = false,
}: {
  initialBatch: BatchMonitorData;
  /**
   * 只读模式（1025 · B2.9）：客户样片批次（SunnyShutter 样片账号）给所有人浏览，
   * 不是访问者自己的批次——不轮询（状态接口按归属鉴权，轮询只会 404）、
   * 不出现「重试 / 取消」，只能看和下载成片。
   */
  readOnly?: boolean;
}) {
  const { locale } = useTranslation();
  const english = locale === "en-US";
  const batchCopy = getPlatformCopy(locale).batches;
  const monitorCopy = batchCopy.monitor;
  const libraryCopy = getPlatformCopy(locale).library;
  const jobLabels = monitorCopy.jobStatuses;
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
  // 页面切到后台就停（每个开着的标签页都会 POST 一份 tick，bughunt #18）；回到前台先补拉一次再续上节拍。
  useEffect(() => {
    if (readOnly || TERMINAL_BATCH.has(batch.status)) return;
    let timer: number | null = null;
    const tick = () => {
      void refresh().catch((reason) => setError((reason as Error).message));
    };
    const start = () => {
      if (timer === null) timer = window.setInterval(tick, 15_000);
    };
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      tick();
      start();
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [batch.status, readOnly, refresh]);

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
  const templateName = english ? batch.template.name : batch.template.nameZh;
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
      requestPulseRefresh();
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

      <QuoteHeader
        title={batch.productName ?? templateName}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusTick entity="batch" state={batchState(batch.status)} locale={locale} />
            {readOnly ? <MonoTag>{monitorCopy.readOnly}</MonoTag> : null}
            <span>{templateName} · {monitorCopy.templateVersion} v{batch.template.version}</span>
            <span className="break-all font-mono text-data tabular-nums text-tertiary">{monitorCopy.batch} {batch.id}</span>
          </span>
        }
        /// 批次详情没有实心主钮：重试 / 取消是描边的次要行动，下载所选在任务列表上方
        primaryAction={null}
        secondaryActions={
          !readOnly && (retryableFailedJobs.length > 0 || batch.queuedCount + batch.pausedCount > 0) ? (
            <>
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
            </>
          ) : undefined
        }
        readingsLabel={monitorCopy.progress}
        readings={batchMonitorReadings(batch, {
          copy: monitorCopy,
          locale,
          progress: totalProgress,
          live: !TERMINAL_BATCH.has(batch.status) && !readOnly,
        })}
        scope={fillCopy(readOnly ? monitorCopy.readOnlyScope : monitorCopy.scope, { n: batch.requestedCount })}
      />

      {batch.status === "PAUSED" && (
        <div className="flex items-start gap-3 border-l-2 border-warning pl-4 text-meta text-foreground">
          <PauseCircle
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden
          />
          <span>{monitorCopy.paused.replace("{count}", String(batch.pausedCount))}</span>
        </div>
      )}

      <section aria-label={monitorCopy.progress} className="x-panel space-y-4 p-4 sm:p-5">
        <Progress value={totalProgress} aria-label={`${monitorCopy.progress} ${totalProgress}%`} />
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
      </section>

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
                data-beam={job.status === "RUNNING" && !readOnly ? "row" : undefined}
                /// 窄屏（<640px）两行卡片：首行 编号 + 状态，次行 进度 / 原因 + 动作；不再 680px 最小宽度横向滑
                className="absolute left-0 top-0 grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2.5 hover:bg-secondary sm:flex sm:h-14 sm:min-w-[680px] sm:gap-3 sm:py-0"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <label className="row-span-2 flex size-5 shrink-0 items-center justify-center sm:row-span-1">
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
                    aria-label={fillCopy(monitorCopy.selectVideo, { n: (job.batchIndex ?? 0) + 1 })}
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
                  className="relative row-span-2 flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-sm) bg-secondary font-mono text-meta text-muted-foreground sm:row-span-1 sm:h-[54px] sm:w-24"
                  aria-label={fillCopy(monitorCopy.viewVideo, { n: (job.batchIndex ?? 0) + 1 })}
                >
                  {job.status === "SUCCEEDED" && job.outputVideoUrl ? (
                    <><video
                        src={job.outputVideoUrl}
                        poster={thumb ?? undefined}
                        muted
                        playsInline
                        preload="none"
                        className="pointer-events-none size-full object-cover"
                      /><AiGeneratedLabel compact className="pointer-events-none absolute bottom-1 left-1 px-1 py-0.5" /></>
                  ) : thumb ? (
                    <Image src={thumb} alt="" fill unoptimized sizes="96px" className="object-cover" />
                  ) : (
                    `#${(job.batchIndex ?? 0) + 1}`
                  )}
                </button>
                <div className="flex min-w-0 items-center justify-between gap-2 sm:block sm:w-40 sm:shrink-0">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-meta font-semibold text-foreground">{monitorCopy.video} #{(job.batchIndex ?? 0) + 1}</p>
                    <p className="hidden truncate font-mono text-meta text-muted-foreground sm:block" title={job.id}>{job.id}</p>
                  </div>
                  <StatusTick entity="item" state={videoJobState(job.status)} locale={locale} className="sm:hidden" />
                </div>
                <StatusTick entity="item" state={videoJobState(job.status)} locale={locale} className="hidden w-20 sm:inline-flex" />
                <div className="col-start-3 flex min-w-0 items-center gap-2 sm:contents">
                <div className="min-w-0 flex-1 sm:min-w-32">
                  {job.status === "RUNNING" ? <Progress value={job.lastProgress ?? 8} aria-label={fillCopy(monitorCopy.videoProgress, { n: (job.batchIndex ?? 0) + 1, p: job.lastProgress ?? 8 })} /> : null}
                  {job.status === "FAILED" ? <p className="truncate text-meta text-danger">{jobFailureSummary(job, monitorCopy.failures, english)}</p> : null}
                  {job.status === "SUCCEEDED" ? <p className="flex items-center gap-1.5 text-meta text-success"><CheckCircle2 className="size-3" aria-hidden />{monitorCopy.ready}</p> : null}
                  {job.status === "CANCELLED" ? <p className="flex items-center gap-1.5 text-meta text-muted-foreground"><XCircle className="size-3" aria-hidden />{monitorCopy.cancelled}</p> : null}
                  {job.status === "QUEUED" ? (
                    <p className="truncate text-meta text-muted-foreground">
                      {job.storyboard?.status === "APPROVED"
                        ? monitorCopy.storyboardLocked
                        : job.storyboard
                          ? fillCopy(monitorCopy.storyboardProgress, { done: job.storyboard.frames.filter((frame) => frame.status === "SUCCEEDED").length })
                          : monitorCopy.storyboardWaiting}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-right font-mono text-meta tabular-nums text-muted-foreground sm:w-14">{job.retryCount} {monitorCopy.retryCount}</p>
                {readOnly ? (
                  <span className="hidden w-[72px] sm:block" aria-hidden />
                ) : job.status === "FAILED" && job.error?.retryable ? (
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
                ) : <span className="hidden w-[72px] sm:block" aria-hidden />}
                </div>
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
              {/* 抽屉内容统一在同一条 max-w-5xl 轴上：标题和正文分属两个容器时，
                  标题会贴到视口最左，正文居中，读起来像两个页面。 */}
              <div className="mx-auto w-full max-w-5xl space-y-6 px-6 pb-8">
                <SheetHeader className="px-0">
                  <SheetTitle>{monitorCopy.video} #{(detailJob.batchIndex ?? 0) + 1}</SheetTitle>
                  <SheetDescription>
                    {jobLabels[detailJob.status]}
                    {detailJob.status === "FAILED"
                      ? ` · ${jobFailureSummary(detailJob, monitorCopy.failures, english)}`
                      : ""}
                  </SheetDescription>
                </SheetHeader>

                {/* 成片是用户打开抽屉要看的东西 —— 放在最前面，占主视觉。 */}
                {detailJob.outputVideoUrl ? (
                  <section className="space-y-3" aria-label={monitorCopy.finishedVideo}>
                    <div className="flex justify-center rounded-(--radius-lg) border border-border bg-secondary/30 p-4">
                      <div className="relative inline-block max-w-full">
                        <video
                          src={detailJob.outputVideoUrl}
                          poster={detailJob.outputThumbUrl ?? undefined}
                          controls
                          preload="metadata"
                          className="max-h-[min(58vh,720px)] w-auto max-w-full rounded-(--radius-md) border border-border bg-black object-contain"
                        />
                        <AiGeneratedLabel className="pointer-events-none absolute left-3 top-3" />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={detailJob.outputVideoUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ size: "sm" })}
                      >
                        <Download aria-hidden />
                        {libraryCopy.download}
                      </a>
                    </div>
                  </section>
                ) : null}

                {detailJob.error && !readOnly ? (
                  <p className="rounded-(--radius-sm) border border-border p-3 text-meta text-foreground">
                    {dispatchRecoveryHint(
                      detailJob.error.action,
                      english ? "en-US" : "zh-CN",
                    )}
                  </p>
                ) : null}

                <ol className="grid gap-2 text-meta sm:grid-cols-4" aria-label={monitorCopy.workflowLabel}>
                  {monitorCopy.workflowSteps.map((label, index) => {
                    const done =
                      index === 0 ||
                      (index === 1 && detailJob.storyboard?.status === "APPROVED") ||
                      (index > 1 && detailJob.status === "SUCCEEDED");
                    return (
                      <li
                        key={label}
                        className={cn(
                          "flex items-center gap-2 rounded-(--radius-sm) border px-3 py-2",
                          done ? "border-border-strong bg-card" : "border-dashed border-border bg-transparent",
                        )}
                      >
                        {done ? (
                          <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                        ) : (
                          <span className="size-1.5 shrink-0 rounded-(--radius-sm) bg-muted-foreground/50" aria-hidden />
                        )}
                        <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                      </li>
                    );
                  })}
                </ol>

                {/* 历史成片没有分镜记录：一句话说明即可。渲染 4 个空的 9:16 占位框
                    会把「什么都没有」放大成整屏噪音，压过真正的成片。 */}
                {(() => {
                  const legacy = !detailJob.storyboard && detailJob.status === "SUCCEEDED";
                  if (legacy) {
                    return (
                      <p className="x-well rounded-(--radius-sm) px-3 py-2 text-meta text-muted-foreground">
                        {monitorCopy.legacyVideo}
                      </p>
                    );
                  }
                  return (
                    <section className="space-y-3" aria-labelledby="batch-storyboard-title">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 id="batch-storyboard-title" className="font-medium text-foreground">
                            {monitorCopy.storyboardTitle}
                          </h3>
                          <p className="text-meta text-muted-foreground">
                            {monitorCopy.storyboardHint}
                          </p>
                        </div>
                        <Badge variant={detailJob.storyboard?.status === "APPROVED" ? "success" : detailJob.storyboard?.status === "FAILED" ? "destructive" : "secondary"}>
                          {detailJob.storyboard?.status === "APPROVED"
                            ? monitorCopy.storyboardApproved
                            : detailJob.storyboard?.status === "FAILED"
                              ? monitorCopy.storyboardAttention
                              : stateWord("frame", "generating", locale)}
                        </Badge>
                      </div>
                      {/* 分镜是参考信息，不该跟成片抢版面：限制每格高度 */}
                      <div className="grid grid-cols-4 gap-3">
                        {Array.from({ length: 4 }, (_, ordinal) => {
                          const frame = detailJob.storyboard?.frames.find((item) => item.ordinal === ordinal);
                          return (
                            <div key={frame?.id ?? ordinal} className="space-y-2">
                              <div className="relative aspect-9/16 max-h-44 overflow-hidden rounded-(--radius-sm) border border-border bg-secondary">
                                {frame?.imageUrl ? (
                                  <Image src={frame.imageUrl} alt={english ? `Storyboard frame ${ordinal + 1}` : `故事板分镜 ${ordinal + 1}`} fill unoptimized sizes="(max-width: 640px) 25vw, 140px" className="object-contain" />
                                ) : (
                                  <div className="flex size-full items-center justify-center text-meta text-muted-foreground">
                                    {frame?.status === "FAILED"
                                      ? (english ? "Failed" : "失败")
                                      : (english ? "Generating…" : "生成中…")}
                                  </div>
                                )}
                              </div>
                              <p className="font-mono text-meta text-muted-foreground">{fillCopy(monitorCopy.frameLabel, { n: ordinal + 1 })} · {stateWord("frame", FRAME_STATE[frame?.status ?? "QUEUED"], locale)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })()}

                {detailJob.status === "RUNNING" && (
                  <Progress
                    value={detailJob.lastProgress ?? 8}
                    aria-label={english ? `Video ${(detailJob.batchIndex ?? 0) + 1} progress` : `视频 ${(detailJob.batchIndex ?? 0) + 1} 生成进度`}
                  />
                )}
                {!readOnly && detailJob.status === "FAILED" && detailJob.error?.retryable && (
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
