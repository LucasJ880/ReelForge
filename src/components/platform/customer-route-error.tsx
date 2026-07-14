"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { useTranslation } from "@/i18n/useTranslation";
import {
  CUSTOMER_ROUTE_FALLBACKS,
  type CustomerRouteId,
} from "./customer-route-state";

export function CustomerRouteError({
  error,
  reset,
  route,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  route: CustomerRouteId;
}) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).routeStates;
  const area = copy.areas[route];

  return (
    <section
      data-route-state="error"
      data-customer-route={route}
      role="alert"
      aria-live="assertive"
      className="editorial-page-stack min-w-0"
    >
      <div className="max-w-2xl rounded-(--radius-lg) border border-danger/40 bg-card p-6 sm:p-8">
        <span className="flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle aria-hidden className="size-5" />
        </span>
        <h1 className="mt-5 font-heading text-title font-semibold">
          {copy.errorTitle.replace("{area}", area)}
        </h1>
        <p className="mt-2 max-w-xl text-body text-muted-foreground">
          {copy.errorBody}
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-meta tabular-nums text-muted-foreground">
            {copy.errorCode}: {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={reset}>
            <RefreshCw aria-hidden />
            {copy.retry}
          </Button>
          <Button
            render={<Link href={CUSTOMER_ROUTE_FALLBACKS[route]} />}
            variant="outline"
          >
            <ArrowLeft aria-hidden />
            {copy.back}
          </Button>
        </div>
      </div>
    </section>
  );
}
