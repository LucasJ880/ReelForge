"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { useTranslation } from "@/i18n/useTranslation";
import type { SurfaceRouteArea } from "./surface-route-loading";

export function SurfaceRouteError({
  area,
  error,
  reset,
}: {
  area: SurfaceRouteArea;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).routeStates;
  const areaLabel = copy.areas[area];

  return (
    <section
      data-route-state="error"
      role="alert"
      aria-live="assertive"
      className="mx-auto w-full max-w-3xl px-4 py-10 text-foreground sm:px-8"
    >
      <div className="rounded-(--radius-lg) border border-danger/40 bg-card p-6 sm:p-8">
        <span className="flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle aria-hidden className="size-5" />
        </span>
        <h1 className="mt-5 font-heading text-title font-semibold">
          {copy.errorTitle.replace("{area}", areaLabel)}
        </h1>
        <p className="mt-2 max-w-xl text-body text-muted-foreground">
          {copy.errorBody}
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-meta tabular-nums text-muted-foreground">
            {copy.errorCode}: {error.digest}
          </p>
        ) : null}
        <Button type="button" onClick={reset} className="mt-6">
          <RefreshCw aria-hidden />
          {copy.retry}
        </Button>
      </div>
    </section>
  );
}
