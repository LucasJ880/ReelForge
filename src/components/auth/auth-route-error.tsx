"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { useTranslation } from "@/i18n/useTranslation";

export function AuthRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale);
  const title = copy.routeStates.errorTitle.replace(
    "{area}",
    copy.auth.studio,
  );

  return (
    <div
      data-route-state="error"
      role="alert"
      aria-live="assertive"
      className="auth-studio-theme studio-canvas flex min-h-screen items-center justify-center bg-background px-6 text-foreground"
    >
      <div className="w-full max-w-md rounded-(--radius-lg) border border-danger/40 bg-card p-6 text-center sm:p-8">
        <Logo size={48} className="mx-auto" />
        <span className="mx-auto mt-6 flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle aria-hidden className="size-5" />
        </span>
        <h1 className="mt-4 font-heading text-title font-semibold">{title}</h1>
        <p className="mt-2 text-body text-muted-foreground">
          {copy.routeStates.errorBody}
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-meta tabular-nums text-muted-foreground">
            {copy.routeStates.errorCode}: {error.digest}
          </p>
        ) : null}
        <Button type="button" onClick={reset} className="mt-6">
          <RefreshCw aria-hidden />
          {copy.routeStates.retry}
        </Button>
      </div>
    </div>
  );
}
