"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/useTranslation";

export function VideoActions({
  briefId,
  failedSceneCount,
  canRetry,
}: {
  briefId: string;
  failedSceneCount: number;
  canRetry: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  async function post(kind: "refresh" | "retry") {
    setFeedback(null);
    if (kind === "refresh") setRefreshing(true);
    else setRetrying(true);
    try {
      const response = await fetch(
        `/api/briefs/${briefId}/${kind === "refresh" ? "render-status" : "render-retry"}`,
        kind === "refresh"
          ? { method: "POST" }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ all: true }),
            },
      );
      if (!response.ok) {
        setFeedback(
          t(
            kind === "refresh"
              ? "shell.videoActions.refreshFailed"
              : "shell.videoActions.retryFailedMsg",
          ),
        );
      } else {
        if (kind === "retry") setFeedback(t("shell.videoActions.retryStarted"));
        startTransition(() => router.refresh());
      }
    } catch {
      setFeedback(t("shell.videoActions.networkError"));
    } finally {
      if (kind === "refresh") setRefreshing(false);
      else setRetrying(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={refreshing || pending}
        onClick={() => void post("refresh")}
      >
        {refreshing ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw aria-hidden />}
        {t("shell.videoActions.refresh")}
      </Button>
      {canRetry ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={retrying || pending}
          onClick={() => void post("retry")}
        >
          {retrying ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw aria-hidden />}
          {t("shell.videoActions.retryFailed")}
          {failedSceneCount > 0 ? <span className="font-mono text-meta">({failedSceneCount})</span> : null}
        </Button>
      ) : null}
      {feedback ? <span role="status" className="text-meta text-muted-foreground">{feedback}</span> : null}
    </div>
  );
}
