"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-wrap items-center gap-2 [&_svg]:stroke-[1.5]">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRefresh}
        disabled={refreshDisabled}
      >
        {refreshing ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <RefreshCw aria-hidden />
        )}
        刷新进度
      </Button>
      {canRetry ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={handleRetry}
          disabled={retryDisabled}
        >
          {retrying ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <RotateCcw aria-hidden />
          )}
          {failedSceneCount > 0 ? "重试失败片段" : "重试"}
          {failedSceneCount > 0 ? (
            <span className="ml-1 text-meta">
              ({failedSceneCount})
            </span>
          ) : null}
        </Button>
      ) : null}
      {feedback ? (
        <span
          role="status"
          className="ml-2 text-meta text-muted-foreground"
        >
          {feedback}
        </span>
      ) : null}
    </div>
  );
}
