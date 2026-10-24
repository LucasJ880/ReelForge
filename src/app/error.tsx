"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { TickGlyph } from "@/components/exchange/status-tick";

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
    <div className="desk-canvas relative flex min-h-[70vh] flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
      <Logo size={36} />
      <TickGlyph tone="fault" className="size-[clamp(40px,6vw,72px)] text-danger" />
      <h1 className="x-display text-[clamp(28px,4vw,44px)]">出了点问题</h1>
      <p className="max-w-md text-body leading-relaxed text-muted-foreground">
        系统遇到意外错误。我们已记录这个问题，你可以试着重新加载或回到工作台。
      </p>
      {error.digest && (
        <p className="font-mono text-data text-tertiary">
          错误编号：<span className="text-muted-foreground">{error.digest}</span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center gap-2 rounded-(--radius-md) border border-primary bg-primary px-4 text-meta font-semibold text-primary-foreground transition-colors hover:border-accent-strong hover:bg-accent-strong"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          重新加载
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-(--radius-md) border border-border-strong px-4 text-meta font-semibold text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          回到工作台
        </Link>
      </div>
    </div>
  );
}
