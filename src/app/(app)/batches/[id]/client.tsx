"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface BatchProject {
  id: string;
  keyword: string;
  status: string;
  batchIndex: number;
  errorMessage: string | null;
  contentPlan: { id: string; caption: string; videoPrompt: string } | null;
  videoJob: { id: string; status: string; videoUrl: string | null } | null;
}

interface BatchData {
  id: string;
  name: string;
  status: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  concurrency: number;
  autoGenerateVideo: boolean;
  videoParams: { duration?: number; ratio?: string; resolution?: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  projects: BatchProject[];
}

const projectStatusLabels: Record<string, string> = {
  DRAFT: "待处理",
  CONTENT_GENERATED: "内容已生成",
  VIDEO_GENERATING: "视频生成中",
  VIDEO_FAILED: "视频失败",
  VIDEO_READY: "视频就绪",
  DONE: "已完成",
};

export function BatchDetailClient({ initial }: { initial: BatchData }) {
  const [batch, setBatch] = useState(initial);
  const isRunning = batch.status === "RUNNING";

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/batches/${batch.id}`);
      if (res.ok) setBatch(await res.json());
    } catch { /* silent */ }
  }, [batch.id]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [isRunning, refresh]);

  const pct = batch.totalCount > 0
    ? Math.round(((batch.completedCount + batch.failedCount) / batch.totalCount) * 100)
    : 0;

  const videoReadyCount = batch.projects.filter((p) => p.videoJob?.status === "COMPLETED").length;
  const contentDoneCount = batch.projects.filter((p) => p.contentPlan !== null).length;

  async function handleAction(action: string) {
    try {
      const res = await fetch(`/api/batches/${batch.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "操作失败"); }
      toast.success(action === "pause" ? "批次已暂停" : "批次已启动");
      setTimeout(refresh, 1000);
    } catch (e) { toast.error(e instanceof Error ? e.message : "操作失败"); }
  }

  const statusDot: Record<string, string> = {
    PENDING: "bg-zinc-300",
    RUNNING: "bg-teal-500 animate-pulse",
    PAUSED: "bg-amber-400",
    COMPLETED: "bg-emerald-500",
    FAILED: "bg-red-500",
  };

  const statusLabel: Record<string, string> = {
    PENDING: "等待中",
    RUNNING: "执行中",
    PAUSED: "已暂停",
    COMPLETED: "已完成",
    FAILED: "失败",
  };

  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors";
  const primary = `${btn} bg-teal-600 text-white hover:bg-teal-700`;
  const secondary = `${btn} bg-zinc-800/50 text-zinc-100 hover:bg-white/5`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium">
              批次详情
            </p>
            <span className={cn("h-2 w-2 rounded-full", statusDot[batch.status] || "bg-zinc-300")} />
            <span className="text-[11px] text-zinc-400">{statusLabel[batch.status] || batch.status}</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            {batch.name}
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            {formatDate(batch.createdAt)}
            {batch.completedAt && ` · 完成于 ${formatDate(batch.completedAt)}`}
          </p>
        </div>
        <div className="flex gap-2">
          {isRunning && (
            <button className={secondary} onClick={() => handleAction("pause")}>
              <Pause className="h-3.5 w-3.5" />
              暂停
            </button>
          )}
          {(batch.status === "PAUSED" || batch.status === "PENDING") && (
            <button className={primary} onClick={() => handleAction("resume")}>
              <Play className="h-3.5 w-3.5" />
              {batch.status === "PAUSED" ? "继续" : "启动"}
            </button>
          )}
          {batch.status === "COMPLETED" && batch.failedCount > 0 && (
            <button className={secondary} onClick={() => handleAction("retry")}>
              <RotateCcw className="h-3.5 w-3.5" />
              重试失败项 ({batch.failedCount})
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
          <span>{batch.completedCount + batch.failedCount} / {batch.totalCount}</span>
          <span className="font-medium tabular-nums">{pct}%</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <StatInline label="总数" value={batch.totalCount} />
        <StatInline label="内容完成" value={contentDoneCount} color="text-teal-400" />
        <StatInline label="视频就绪" value={videoReadyCount} color="text-emerald-400" />
        {batch.failedCount > 0 && <StatInline label="失败" value={batch.failedCount} color="text-red-500" />}
      </div>

      {/* Config tags */}
      <div className="flex flex-wrap gap-1.5">
        {[
          `并发 ${batch.concurrency}`,
          batch.videoParams && `${(batch.videoParams as { duration?: number }).duration || 5}s`,
          batch.videoParams && `${(batch.videoParams as { ratio?: string }).ratio || "9:16"}`,
          batch.videoParams && `${(batch.videoParams as { resolution?: string }).resolution || "720p"}`,
          batch.autoGenerateVideo ? "内容+视频" : "仅内容",
        ].filter(Boolean).map((tag, i) => (
          <span key={i} className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] text-zinc-400">
            {tag}
          </span>
        ))}
      </div>

      {/* Project list */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-3">
          项目列表
        </p>
        <div className="space-y-1">
          {batch.projects.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatInline({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div>
      <p className={cn("text-2xl font-extralight tabular-nums", color || "text-white")}>{value}</p>
      <p className="text-[11px] text-zinc-400">{label}</p>
    </div>
  );
}

function ProjectRow({ project }: { project: { id: string; keyword: string; status: string; errorMessage: string | null; contentPlan: { caption: string } | null; videoJob: { status: string } | null } }) {
  const statusLabel = projectStatusLabels[project.status] || project.status;
  const isProcessing = project.status === "VIDEO_GENERATING";
  const isFailed = project.status.includes("FAILED");
  const isDone = project.videoJob?.status === "COMPLETED" || project.status === "VIDEO_READY" || project.status === "DONE";

  return (
    <Link href={`/projects/${project.id}`}>
      <div className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-white/5 transition-colors group">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0">
            {isDone ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : isFailed ? (
              <XCircle className="h-4 w-4 text-red-400" />
            ) : isProcessing ? (
              <Loader2 className="h-4 w-4 text-teal-400 animate-spin" />
            ) : (
              <Clock className="h-4 w-4 text-zinc-500" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-zinc-100 truncate">{project.keyword}</p>
            {project.errorMessage && (
              <p className="text-[11px] text-red-400 truncate max-w-[300px]">{project.errorMessage}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            "text-[11px] font-medium",
            isFailed ? "text-red-400" : isDone ? "text-emerald-400" : isProcessing ? "text-teal-400" : "text-zinc-400"
          )}>
            {statusLabel}
          </span>
          <ExternalLink className="h-3 w-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </Link>
  );
}
