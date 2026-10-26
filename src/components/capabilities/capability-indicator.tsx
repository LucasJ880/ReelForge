"use client";

import Link from "next/link";
import { TickGlyph, tickToneClass } from "@/components/exchange/status-tick";
import { useCapabilities } from "@/components/capabilities/use-capabilities";
import type { Locale } from "@/i18n/config";
import { getPlatformCopy } from "@/i18n/platform-copy";
import type { PublicCapabilities } from "@/lib/capabilities/registry";
import { cn } from "@/lib/utils";

/**
 * C4 · 壳层状态栏里的能力提示：有能力暂停时亮「部分 AI 能力暂停 · N」（失败记号），
 * 只有不稳定时亮「部分 AI 能力不稳定 · N」（半圆记号），全部正常时不占位。点进去是 /app/status。
 */
export function CapabilityIndicator({
  initial,
  locale,
  className,
}: {
  initial: PublicCapabilities | null;
  locale: Locale;
  className?: string;
}) {
  const capabilities = useCapabilities(initial);
  if (!capabilities || (!capabilities.paused && !capabilities.unstable)) return null;
  const copy = getPlatformCopy(locale).shell;
  const tone = capabilities.paused ? "fault" : "partial";
  const count = capabilities.paused ? capabilities.counts.unavailable : capabilities.counts.degraded;
  return (
    <Link
      href="/app/status"
      prefetch={false}
      data-testid="capability-indicator"
      data-state={capabilities.paused ? "paused" : "unstable"}
      title={copy.capabilitiesLink}
      className={cn("flex items-center gap-1.5 text-muted-foreground hover:text-foreground", className)}
    >
      <TickGlyph tone={tone} className={tickToneClass(tone)} />
      <span>{capabilities.paused ? copy.capabilitiesPaused : copy.capabilitiesUnstable}</span>
      <span className="font-mono tabular-nums text-foreground">{count}</span>
    </Link>
  );
}
