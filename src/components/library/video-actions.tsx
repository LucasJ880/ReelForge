"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuotaNextSteps } from "@/components/quota/quota-next-steps";
import { useTranslation } from "@/i18n/useTranslation";
import { quotaNextStepsCopy } from "@/lib/quota-next-steps";

export function VideoActions({
  briefId,
  failedSceneCount,
  canRetry,
  contactEmail = null,
}: {
  briefId: string;
  failedSceneCount: number;
  canRetry: boolean;
  /** 对外联系邮箱（服务端取值传入）：重试撞上本月额度用完时给「联系我们」入口（审计 A7）。 */
  contactEmail?: string | null;
}) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  /// 重试前要先补扣已返还的那一条额度；额度用完时接口回 QUOTA_EXCEEDED，这里给真实下一步而不是笼统的「重试失败」。
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  async function post(kind: "refresh" | "retry") {
    setFeedback(null);
    setQuotaExhausted(false);
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
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        if (kind === "retry" && body?.code === "QUOTA_EXCEEDED") {
          setQuotaExhausted(true);
          setFeedback(quotaNextStepsCopy(locale).exhausted);
          return;
        }
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
      {quotaExhausted ? <QuotaNextSteps locale={locale} contactEmail={contactEmail} className="basis-full" /> : null}
    </div>
  );
}
