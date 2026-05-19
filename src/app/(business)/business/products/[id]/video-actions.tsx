"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";

interface VideoActionsProps {
  briefId: string;
  failedSceneCount: number;
  canRetry: boolean;
}

export function VideoActions({
  briefId,
  failedSceneCount,
  canRetry,
}: VideoActionsProps) {
  const router = useRouter();
  const { t } = useTranslation();
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
        setFeedback(t("shell.videoActions.refreshFailed"));
      } else {
        startTransition(() => router.refresh());
      }
    } catch {
      setFeedback(t("shell.videoActions.networkError"));
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
        setFeedback(t("shell.videoActions.retryFailedMsg"));
      } else {
        setFeedback(t("shell.videoActions.retryStarted"));
        startTransition(() => router.refresh());
      }
    } catch {
      setFeedback(t("shell.videoActions.networkError"));
    } finally {
      setRetrying(false);
    }
  }

  const refreshDisabled = refreshing || pending;
  const retryDisabled = retrying || pending || !canRetry;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshDisabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-card/90 hover:text-foreground disabled:opacity-60"
      >
        {refreshing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {t("shell.videoActions.refresh")}
      </button>
      {canRetry ? (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retryDisabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
        >
          {retrying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          {t("shell.videoActions.retryFailed")}
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

