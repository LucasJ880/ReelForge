"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/features/status-badge";
import {
  VIDEO_JOB_USER_LABELS,
  VIDEO_JOB_USER_HELPER,
  VIDEO_PROGRESS_STEPS,
  ACTION_BUTTON_LABELS,
  videoJobStatusTone,
  briefStatusToProgressIndex,
} from "@/lib/labels-user";
import type { BriefRenderUserStatus } from "@/lib/services/video-service";
import type { VideoBriefStatus, VideoJobStatus, VideoProvider } from "@prisma/client";

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
    }, 60_000);
    return () => clearInterval(t);
  }, [briefId, summary.running, summary.queued]);

  async function refreshStatus() {
    setBusy("refresh");
    try {
      const res = await fetch(`/api/briefs/${briefId}/render-status`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "刷新失败");
      setSummary(data);
      toast.success("已刷新视频生成状态");
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
      if (!res.ok) throw new Error(data.error || "重试失败");
      setSummary(data);
      toast.success(jobId ? "已重新生成该任务" : "已重新生成全部失败任务");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function regenerateAll() {
    if (!allowRegenerate || !onRegenerateAll) return;
    if (!confirm("确认重新生成全部视频？已经在生成中的请求不会被重复扣费，但若最后失败需要重新发起将产生新的视频生成费用。")) {
      return;
    }
    setBusy("regen");
    try {
      await onRegenerateAll();
      toast.success("已发起重新生成");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const progressIndex = briefStatusToProgressIndex(summary.briefStatus);
  const hasFailed = summary.failed > 0;

  return (
    <div className="space-y-3">
      {/* 4 步进度 */}
      <ol className="grid gap-2 md:grid-cols-4">
        {VIDEO_PROGRESS_STEPS.map((step, idx) => {
          const reached = idx < progressIndex;
          const active = idx === progressIndex;
          return (
            <li
              key={step.key}
              className={[
                "rounded-md border px-3 py-2 text-xs",
                reached
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : active
                    ? "border-blue-500/30 bg-blue-500/10 text-blue-200"
                    : "border-border/60 bg-secondary/30 text-muted-foreground",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                    reached
                      ? "bg-emerald-500/30"
                      : active
                        ? "bg-blue-500/30"
                        : "bg-secondary",
                  ].join(" ")}
                >
                  {reached ? "✓" : idx + 1}
                </span>
                <span className="font-medium">{step.label}</span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* 父级聚合 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge tone="success">{summary.succeeded}/{summary.totalJobs} 视频已生成</StatusBadge>
        {summary.running + summary.queued > 0 && (
          <StatusBadge tone="info">{summary.running + summary.queued} 正在生成</StatusBadge>
        )}
        {summary.failed > 0 && (
          <StatusBadge tone="danger">{summary.failed} 失败</StatusBadge>
        )}
        {summary.cancelled > 0 && (
          <StatusBadge tone="neutral">{summary.cancelled} 已取消</StatusBadge>
        )}
        {summary.hasStuckJob && (
          <StatusBadge tone="warning">部分任务时间较长</StatusBadge>
        )}
        {summary.lastCheckedAt && (
          <span className="text-muted-foreground">
            上次检查：{new Date(summary.lastCheckedAt).toLocaleString("zh-CN")}
          </span>
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
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {ACTION_BUTTON_LABELS.refreshStatus}
        </Button>
        {hasFailed && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || isPending}
            onClick={() => retryJob()}
          >
            {busy === "retry-all" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {ACTION_BUTTON_LABELS.retryAll}
          </Button>
        )}
        {allowRegenerate && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || isPending}
            onClick={regenerateAll}
          >
            {busy === "regen" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {ACTION_BUTTON_LABELS.regenerateVideo}
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

      {/* Debug 抽屉 */}
      {summary.jobs.length > 0 && (
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setShowDebug((v) => !v)}
        >
          {showDebug ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {showDebug ? "隐藏开发者信息" : "显示开发者信息（Provider / 任务 ID / 原始状态）"}
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
  const tone = videoJobStatusTone(job.userStatusKey);
  const helper = VIDEO_JOB_USER_HELPER[job.userStatusKey];
  const isFailed = job.userStatusKey === "failed";

  return (
    <div className="rounded border border-border/60 bg-secondary/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone}>{VIDEO_JOB_USER_LABELS[job.userStatusKey]}</StatusBadge>
        {typeof job.sceneIndex === "number" && (
          <span className="text-[11px] text-muted-foreground">
            分镜 #{job.sceneIndex}
          </span>
        )}
        {job.outputVideoUrl && (
          <a
            href={job.outputVideoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            预览视频
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
            {busy === "retry-one" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {ACTION_BUTTON_LABELS.retry}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
      {job.userSafeError && (
        <p className="mt-1 text-xs text-destructive">{job.userSafeError}</p>
      )}
      {job.submittedAt && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          提交时间：{new Date(job.submittedAt).toLocaleString("zh-CN")}
          {job.finishedAt && ` · 完成时间：${new Date(job.finishedAt).toLocaleString("zh-CN")}`}
        </p>
      )}

      {showDebug && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-secondary/60 p-2 text-[10px] text-muted-foreground">
{`provider:           ${job.debug.provider}
external_job_id:    ${job.debug.externalJobId ?? "—"}
last_provider_state: ${job.debug.lastProviderStatus ?? "—"}
admin_error:        ${job.debug.adminError ?? "—"}`}
        </pre>
      )}
    </div>
  );
}
