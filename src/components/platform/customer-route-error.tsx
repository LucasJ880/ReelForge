"use client";

import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TickGlyph } from "@/components/exchange/status-tick";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { useTranslation } from "@/i18n/useTranslation";
import {
  CUSTOMER_ROUTE_FALLBACK_AREAS,
  CUSTOMER_ROUTE_FALLBACKS,
  type CustomerRouteId,
} from "./customer-route-state";

/**
 * 区块级错误边界：壳层不被冲掉，只有这一块说「暂时无法加载」。
 * 记号用失败的下跌三角（TickGlyph），不用警示三角方块；「返回」按钮写明去处。
 */
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
  const backArea = copy.areas[CUSTOMER_ROUTE_FALLBACK_AREAS[route]];

  return (
    <section
      data-route-state="error"
      data-customer-route={route}
      role="alert"
      aria-live="assertive"
      className="x-stack min-w-0"
    >
      <div className="x-panel max-w-2xl border-danger/40 p-6 sm:p-8">
        <p className="flex items-center gap-2 font-mono text-data uppercase tracking-wide text-danger">
          <TickGlyph tone="fault" />
          {area}
        </p>
        <h1 className="mt-4 text-title font-medium">
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
            {copy.backTo.replace("{area}", backArea)}
          </Button>
        </div>
      </div>
    </section>
  );
}
