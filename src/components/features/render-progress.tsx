"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, RefreshCw, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/features/status-badge";
import {
  videoJobStatusTone,
  briefStatusToProgressIndex,
} from "@/lib/labels-user";
import { useTranslation } from "@/i18n/useTranslation";
import type { BriefRenderUserStatus } from "@/lib/services/video-service";
import type {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";

const PROGRESS_STEP_KEYS = [
  "video.progress.scriptReady",
  "video.progress.submitted",
  "video.progress.generating",
  "video.progress.ready",
] as const;

/**
 * 用户视角的视频生成进度面板。
 *
 * 这个组件替代旧的「渲染任务」section：
 * - 顶部：4 步进度条（脚本就绪 → 请求已发送 → 正在生成 → 视频已生成）
 * - 中部：每个 scene job 的友好状态卡（动词化标签 + 帮助文字 + 必要时重试按钮）
 * - 底部：可折叠的 debug 抽屉，里面才放 provider 名/任务 ID/原始状态/admin error
 * - 操作区：刷新状态 / 重试所有失败 / 重新生成全部
 *
 * 数据来源：调用 GET /api/briefs/{id}/render-status，返回 BriefRenderSummary。
 */

export interface RenderJobView {
  id: string;
  sceneIndex?: number | null;
  segmentIndex?: number | null;
  segmentDurationSec?: number | null;
  status: VideoJobStatus;
  userStatusKey: BriefRenderUserStatus;
  outputVideoUrl: string | null;
  outputThumbnailUrl: string | null;
  submittedAt: string | null;
  lastCheckedAt: string | null;
  finishedAt: string | null;
  userSafeError: string | null;
  isStuck: boolean;
  debug: {
    provider: VideoProvider;
    externalJobId: string | null;
    lastProviderStatus: string | null;
    adminError: string | null;
  };
}

export interface FinalVideoView {
  id: string;
  status: FinalVideoStatus;
  targetDurationSec: number;
  segmentCount: number;
  segmentsCompleted: number;
  stitchedVideoUrl: string | null;
  thumbnailUrl: string | null;
  ffmpegError: string | null;
}

export interface RenderSummaryView {
  briefId: string;
  briefStatus: VideoBriefStatus;
  totalJobs: number;
  succeeded: number;
  running: number;
  queued: number;
  failed: number;
  cancelled: number;
  finalVideoUrl: string | null;
  finalThumbnailUrl: string | null;
  hasStuckJob: boolean;
  lastCheckedAt: string | null;
  finalVideo?: FinalVideoView | null;
  jobs: RenderJobView[];
}

interface Props {
  briefId: string;
  initial: RenderSummaryView;
  showDebugByDefault?: boolean;
  /// 是否提供「重新生成全部」按钮（高风险，会扣费）
  allowRegenerate?: boolean;
  onRegenerateAll?: () => Promise<void>;
}

export function RenderProgress({
  briefId,
  initial,
  showDebugByDefault = false,
  allowRegenerate = false,
  onRegenerateAll,
}: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const [summary, setSummary] = useState<RenderSummaryView>(initial);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(showDebugByDefault);

  /// 自动每 60 秒拉取一次最新状态（仅在有任务还在飞时）
  useEffect(() => {
    if (summary.running + summary.queued === 0) return;
    const t = setInterval(() => {
      fetch(`/api/briefs/${briefId}/render-status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) setSummary(data);
        })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(t);
  }, [briefId, summary.running, summary.queued]);

  async function refreshStatus() {
    setBusy("refresh");
    try {
      const res = await fetch(`/api/briefs/${briefId}/render-status`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("error.generic"));
      setSummary(data);
      toast.success(t("video.actions.refreshStatus"));
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retryJob(jobId?: string) {
    const label = jobId ? "retry-one" : "retry-all";
    setBusy(label);
    try {
      const res = await fetch(`/api/briefs/${briefId}/render-retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobId ? { jobId } : { all: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("error.generic"));
      setSummary(data);
      toast.success(t("video.actions.retryFailed"));
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function regenerateAll() {
    if (!allowRegenerate || !onRegenerateAll) return;
    if (!confirm(t("video.actions.regenerateConfirm"))) {
      return;
    }
    setBusy("regen");
    try {
      await onRegenerateAll();
      toast.success(t("video.actions.regenerate"));
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const progressIndex = briefStatusToProgressIndex(summary.briefStatus);
  const hasFailed = summary.failed > 0;
  const fv = summary.finalVideo ?? null;
  const isStitching = fv?.status === "STITCHING" || (
    fv?.status === "PENDING" &&
    fv.segmentsCompleted === fv.segmentCount &&
    fv.segmentCount > 1
  );

  return (
    <div className="space-y-3">
      {/* 4 步进度 */}
      <ol className="grid gap-2 md:grid-cols-4">
        {PROGRESS_STEP_KEYS.map((stepKey, idx) => {
          const reached = idx < progressIndex;
          const active = idx === progressIndex;
          return (
            <li
              key={stepKey}
              className={[
                "rounded-(--radius-md) border px-3 py-2 text-meta",
                reached
                  ? "border-success bg-card text-success"
                  : active
                    ? "border-primary bg-card text-foreground"
                    : "border-border bg-secondary text-muted-foreground",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "flex size-5 items-center justify-center rounded-full text-meta font-bold",
                    reached
                      ? "bg-success text-card"
                      : active
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary",
                  ].join(" ")}
                >
                  {reached ? <Check className="size-3" strokeWidth={1.5} aria-hidden /> : idx + 1}
                </span>
                <span className="font-medium">{t(stepKey)}</span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* 多段拼接信息 */}
      {fv && fv.segmentCount > 1 && (
        <div className="rounded-(--radius-md) border border-primary bg-card px-3 py-2 text-meta text-foreground">
          {isStitching
            ? t("video.progress.stitching")
            : fv.status === "READY"
              ? t("video.progress.ready")
              : t("video.progress.segments", {
                  done: fv.segmentsCompleted,
                  total: fv.segmentCount,
                })}
          {fv.ffmpegError && (
            <span className="ml-2 text-destructive">· {fv.ffmpegError}</span>
          )}
        </div>
      )}

      {/* 父级聚合 */}
      <div className="flex flex-wrap items-center gap-2 text-meta">
        <StatusBadge tone="success">
          {summary.succeeded}/{summary.totalJobs} {t("video.states.ready")}
        </StatusBadge>
        {summary.running + summary.queued > 0 && (
          <StatusBadge tone="info">
            {summary.running + summary.queued} {t("video.states.generating")}
          </StatusBadge>
        )}
        {summary.failed > 0 && (
          <StatusBadge tone="danger">
            {summary.failed} {t("video.states.failed")}
          </StatusBadge>
        )}
        {summary.cancelled > 0 && (
          <StatusBadge tone="neutral">
            {summary.cancelled} {t("video.states.cancelled")}
          </StatusBadge>
        )}
        {summary.hasStuckJob && (
          <StatusBadge tone="warning">{t("video.states.stuck")}</StatusBadge>
        )}
      </div>

      {/* 操作区 */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy || isPending}
          onClick={refreshStatus}
        >
          {busy === "refresh" ? (
            <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />
          ) : (
            <RefreshCw strokeWidth={1.5} aria-hidden />
          )}
          {t("video.actions.refreshStatus")}
        </Button>
        {hasFailed && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || isPending}
            onClick={() => retryJob()}
          >
            {busy === "retry-all" ? (
              <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />
            ) : (
              <RotateCcw strokeWidth={1.5} aria-hidden />
            )}
            {t("video.actions.retryFailed")}
          </Button>
        )}
        {allowRegenerate && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || isPending}
            onClick={regenerateAll}
          >
            {busy === "regen" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
            {t("video.actions.regenerate")}
          </Button>
        )}
      </div>

      {/* 单个任务列表 */}
      {summary.jobs.length > 0 && (
        <div className="space-y-2">
          {summary.jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              busy={busy}
              onRetry={() => retryJob(job.id)}
              showDebug={showDebug}
            />
          ))}
        </div>
      )}

      {/* Debug 抽屉（默认折叠 — 只在用户主动展开时露出 provider / jobId / 原始状态） */}
      {summary.jobs.length > 0 && (
        <button
          type="button"
          className="flex min-h-10 items-center gap-1 rounded-(--radius-md) px-2 text-meta text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => setShowDebug((v) => !v)}
        >
          {showDebug ? (
            <ChevronDown strokeWidth={1.5} aria-hidden />
          ) : (
            <ChevronRight strokeWidth={1.5} aria-hidden />
          )}
          {showDebug ? t("common.hideAdvanced") : t("common.showAdvanced")}
        </button>
      )}
    </div>
  );
}

function JobRow({
  job,
  busy,
  onRetry,
  showDebug,
}: {
  job: RenderJobView;
  busy: string | null;
  onRetry: () => void;
  showDebug: boolean;
}) {
  const { t } = useTranslation();
  const tone = videoJobStatusTone(job.userStatusKey);
  const stateKey = `video.states.${job.userStatusKey}`;
  const helperKey = `video.helpers.${job.userStatusKey}`;
  const isFailed = job.userStatusKey === "failed";

  return (
    <div className="rounded-(--radius-md) border border-border bg-secondary p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone}>{t(stateKey)}</StatusBadge>
        {typeof job.segmentIndex === "number" && (
          <span className="text-meta text-muted-foreground">
            #{job.segmentIndex + 1}
            {job.segmentDurationSec ? ` · ${job.segmentDurationSec}s` : ""}
          </span>
        )}
        {typeof job.sceneIndex === "number" && job.segmentIndex == null && (
          <span className="text-meta text-muted-foreground">
            #{job.sceneIndex}
          </span>
        )}
        {job.outputVideoUrl && (
          <a
            href={job.outputVideoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-meta text-primary hover:underline"
          >
            {t("video.actions.preview")}
          </a>
        )}
        {isFailed && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={onRetry}
            className="ml-auto"
          >
            {busy === "retry-one" && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
            {t("common.retry")}
          </Button>
        )}
      </div>
      <p className="mt-1 text-meta text-muted-foreground">{t(helperKey)}</p>
      {job.userSafeError && (
        <p className="mt-1 text-meta text-danger">{job.userSafeError}</p>
      )}

      {showDebug && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-(--radius-md) bg-card p-3 font-mono text-meta text-muted-foreground">
{`${t("debug.provider")}: ${job.debug.provider}
${t("debug.externalJobId")}: ${job.debug.externalJobId ?? "—"}
${t("debug.rawStatus")}: ${job.debug.lastProviderStatus ?? "—"}
admin_error: ${job.debug.adminError ?? "—"}`}
        </pre>
      )}
    </div>
  );
}
