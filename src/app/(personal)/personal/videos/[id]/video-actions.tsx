"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";

interface VideoActionsProps {
  briefId: string;
  failedSceneCount: number;
  canRetry: boolean;
  statusKey: string;
}

/**
 * Phase 6 — 客户视角的两个操作：
 *   1. 刷新进度：调用 POST /api/briefs/:id/render-status，主动调和 Provider，再 router.refresh
 *   2. 重试失败片段：调用 POST /api/briefs/:id/render-retry { all: true }
 *
 * 两个按钮都对客户语言友好（无 reconcile / dispatch / job 等内部词）。
 * 错误展示也走"友好兜底"——具体后端错误只写 console，不弹给客户。
 */
export function VideoActions({
  briefId,
  failedSceneCount,
  canRetry,
}: VideoActionsProps) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleRefresh() {
    setFeedback(null);
    setRefreshing(true);
    try {
      const res = await fetch(`/api/briefs/${briefId}/render-status`, {
        method: "POST",
      });
      if (!res.ok) {
        setFeedback("刷新失败，请稍后再试");
      } else {
        startTransition(() => router.refresh());
      }
    } catch {
      setFeedback("网络异常，请稍后再试");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRetry() {
    setFeedback(null);
    setRetrying(true);
    try {
      const res = await fetch(`/api/briefs/${briefId}/render-retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) {
        setFeedback("重试失败，请稍后再试或换个描述重新生成");
      } else {
        setFeedback("已开始重试，刷新一下进度看看");
        startTransition(() => router.refresh());
      }
    } catch {
      setFeedback("网络异常，请稍后再试");
    } finally {
      setRetrying(false);
    }
  }

  const refreshDisabled = refreshing || pending;
  const retryDisabled = retrying || pending || !canRetry;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshDisabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-card/90 transition-colors disabled:opacity-60"
      >
        {refreshing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        刷新进度
      </button>
      {canRetry ? (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retryDisabled}
          className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20 transition-colors disabled:opacity-60"
        >
          {retrying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          重试失败片段
          {failedSceneCount > 0 ? (
            <span className="ml-1 text-[10px] opacity-70">
              ({failedSceneCount})
            </span>
          ) : null}
        </button>
      ) : null}
      {feedback ? (
        <span
          role="status"
          className="ml-2 text-[11px] text-muted-foreground"
        >
          {feedback}
        </span>
      ) : null}
    </div>
  );
}
