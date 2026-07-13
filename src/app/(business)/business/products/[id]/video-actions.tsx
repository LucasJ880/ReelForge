"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        {t("shell.videoActions.refresh")}
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
          {t("shell.videoActions.retryFailed")}
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
          className="text-meta text-muted-foreground"
        >
          {feedback}
        </span>
      ) : null}
    </div>
  );
}

