"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  Video,
  FileText,
  ExternalLink,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/lib/utils";

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

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDING: { label: "等待中", color: "bg-gray-100 text-gray-700" },
  RUNNING: { label: "执行中", color: "bg-blue-100 text-blue-700" },
  PAUSED: { label: "已暂停", color: "bg-yellow-100 text-yellow-700" },
  COMPLETED: { label: "已完成", color: "bg-green-100 text-green-700" },
  FAILED: { label: "失败", color: "bg-red-100 text-red-700" },
};

const projectStatusLabels: Record<string, string> = {
  DRAFT: "待处理",
  CONTENT_GENERATED: "内容已生成",
  VIDEO_GENERATING: "视频生成中",
  VIDEO_FAILED: "视频失败",
  VIDEO_READY: "视频就绪",
  PUBLISHING: "发布中",
  PUBLISHED: "已发布",
  ANALYZED: "已分析",
};

export function BatchDetailClient({ initial }: { initial: BatchData }) {
  const router = useRouter();
  const [batch, setBatch] = useState(initial);
  const isRunning = batch.status === "RUNNING";

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/batches/${batch.id}`);
      if (res.ok) {
        setBatch(await res.json());
      }
    } catch {}
  }, [batch.id]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [isRunning, refresh]);

  const progress =
    batch.totalCount > 0
      ? Math.round(
          ((batch.completedCount + batch.failedCount) / batch.totalCount) * 100
        )
      : 0;

  const videoReadyCount = batch.projects.filter(
    (p) => p.videoJob?.status === "COMPLETED"
  ).length;

  const contentDoneCount = batch.projects.filter(
    (p) => p.contentPlan !== null
  ).length;

  async function handleAction(action: string) {
    try {
      const res = await fetch(`/api/batches/${batch.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "操作失败");
      }
      toast.success(action === "pause" ? "批次已暂停" : "批次已启动");
      setTimeout(refresh, 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  const batchStatus = statusConfig[batch.status] || statusConfig.PENDING;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{batch.name}</h2>
            <Badge className={batchStatus.color}>{batchStatus.label}</Badge>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            创建于 {formatDate(batch.createdAt)}
            {batch.completedAt && ` · 完成于 ${formatDate(batch.completedAt)}`}
          </p>
        </div>
        <div className="flex gap-2">
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAction("pause")}
            >
              <Pause className="mr-1.5 h-3.5 w-3.5" />
              暂停
            </Button>
          )}
          {(batch.status === "PAUSED" || batch.status === "PENDING") && (
            <Button size="sm" onClick={() => handleAction("resume")}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {batch.status === "PAUSED" ? "继续" : "启动"}
            </Button>
          )}
          {batch.status === "COMPLETED" && batch.failedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAction("retry")}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              重试失败项 ({batch.failedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Progress Overview */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">
                总进度: {batch.completedCount + batch.failedCount} / {batch.totalCount}
              </span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-3" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{batch.totalCount}</div>
                <div className="text-xs text-gray-500">总数</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600">
                  {contentDoneCount}
                </div>
                <div className="text-xs text-gray-500">内容已生成</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {videoReadyCount}
                </div>
                <div className="text-xs text-gray-500">视频就绪</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {batch.failedCount}
                </div>
                <div className="text-xs text-gray-500">失败</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Batch config summary */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">
          并发: {batch.concurrency}
        </Badge>
        {batch.videoParams && (
          <>
            <Badge variant="outline">
              {(batch.videoParams as { duration?: number }).duration || 5}s
            </Badge>
            <Badge variant="outline">
              {(batch.videoParams as { ratio?: string }).ratio || "9:16"}
            </Badge>
            <Badge variant="outline">
              {(batch.videoParams as { resolution?: string }).resolution || "720p"}
            </Badge>
          </>
        )}
        <Badge variant="outline">
          {batch.autoGenerateVideo ? "内容+视频" : "仅内容"}
        </Badge>
      </div>

      {/* Project List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">项目列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {batch.projects.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectRow({ project }: { project: BatchProject }) {
  const statusLabel = projectStatusLabels[project.status] || project.status;
  const isProcessing = ["VIDEO_GENERATING", "PUBLISHING"].includes(
    project.status
  );
  const isFailed = project.status.includes("FAILED");
  const isDone =
    project.videoJob?.status === "COMPLETED" ||
    project.status === "VIDEO_READY" ||
    project.status === "PUBLISHED";

  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3 hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0">
          {isDone ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : isFailed ? (
            <XCircle className="h-4 w-4 text-red-500" />
          ) : isProcessing ? (
            <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
          ) : (
            <Clock className="h-4 w-4 text-gray-300" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{project.keyword}</p>
          <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
            {project.contentPlan && (
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {project.contentPlan.caption.slice(0, 30)}
                {project.contentPlan.caption.length > 30 ? "..." : ""}
              </span>
            )}
            {project.errorMessage && (
              <span className="text-red-500 truncate max-w-[200px]">
                {project.errorMessage}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge
          variant="secondary"
          className={
            isFailed
              ? "bg-red-50 text-red-600"
              : isDone
                ? "bg-green-50 text-green-600"
                : isProcessing
                  ? "bg-blue-50 text-blue-600"
                  : ""
          }
        >
          {statusLabel}
        </Badge>
        <Link href={`/projects/${project.id}`}>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
