"use client";

import { useEffect, useState } from "react";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { useTranslation } from "@/i18n/useTranslation";
import {
  buddyRouteDiscoverySummary,
  type BuddyRouteDiscoverySummary,
} from "@/components/video-generation/video-route-selector-contract";

export type VideoRouteOverride =
  | ""
  | "byteplus_international"
  | "volcengine_cn_legacy";

export function parseVideoRouteOverride(value: string): VideoRouteOverride {
  return value === "byteplus_international" || value === "volcengine_cn_legacy"
    ? value
    : "";
}

const SELECT_CLASS =
  "mt-1 block h-(--control-height) w-full rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function VideoRouteSelector({
  canSelectVideoRoute,
  value,
  disabled,
  onChange,
}: {
  canSelectVideoRoute: boolean;
  value: VideoRouteOverride;
  disabled: boolean;
  onChange: (value: VideoRouteOverride) => void;
}) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).create.videoRoutes;
  const [buddyDiscovery, setBuddyDiscovery] =
    useState<BuddyRouteDiscoverySummary | null>(null);

  useEffect(() => {
    if (!canSelectVideoRoute) return;
    const controller = new AbortController();
    void fetch("/api/internal/video-provider-routes", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return { state: "unavailable" } as const;
        return buddyRouteDiscoverySummary(await response.json());
      })
      .then((summary) => setBuddyDiscovery(summary))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBuddyDiscovery({ state: "unavailable" });
      });
    return () => controller.abort();
  }, [canSelectVideoRoute]);

  if (!canSelectVideoRoute) return null;

  const buddyStatus = buddyDiscovery === null
    ? copy.buddyChecking
    : buddyDiscovery.state === "available"
      ? copy.buddyModels.replace("{count}", String(buddyDiscovery.modelCount))
      : copy.buddyUnavailable;

  return (
    <label
      className="text-meta font-medium text-muted-foreground"
      data-testid="video-route-selector"
      data-internal-only="true"
    >
      {copy.label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(parseVideoRouteOverride(event.target.value))}
        className={SELECT_CLASS}
      >
        <option value="">{copy.systemDefault}</option>
        <option value="byteplus_international">{copy.byteplusInternational}</option>
        <option value="volcengine_cn_legacy">{copy.volcengineLegacy}</option>
        <option value="buddy" disabled>{copy.buddyPending}</option>
      </select>
      <span className="mt-1 block text-meta font-normal text-muted-foreground">
        {value === "" ? copy.systemDefaultHint : copy.overrideHint} · {buddyStatus}
      </span>
    </label>
  );
}
