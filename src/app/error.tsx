"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h1 className="mt-6 text-xl font-semibold tracking-tight">出了点问题</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        系统遇到意外错误。我们已记录这个问题，你可以试着重新加载或回到工作台。
      </p>
      {error.digest && (
        <p className="mt-3 text-[11px] text-muted-foreground/70">
          错误编号：<span className="font-mono">{error.digest}</span>
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重新加载
        </button>
        <Link
          href="/dashboard"
          className="inline-flex items-center rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          回到工作台
        </Link>
      </div>
    </div>
  );
}
