"use client";

import { useCallback, useState } from "react";
import type { UsageResource } from "@prisma/client";
import { useTranslation } from "@/i18n/useTranslation";
import type { UsagePayload } from "@/lib/services/usage-payload";

const RESOURCE_I18N: Record<
  UsageResource,
  | "shell.billing.resources.videoDispatch"
  | "shell.billing.resources.planPreview"
  | "shell.billing.resources.blobUploadBytes"
  | "shell.billing.resources.seedanceSegment"
  | "shell.billing.resources.digitalHumanAd"
> = {
  VIDEO_DISPATCH: "shell.billing.resources.videoDispatch",
  PLAN_PREVIEW: "shell.billing.resources.planPreview",
  BLOB_UPLOAD_BYTES: "shell.billing.resources.blobUploadBytes",
  SEEDANCE_SEGMENT: "shell.billing.resources.seedanceSegment",
  DIGITAL_HUMAN_AD: "shell.billing.resources.digitalHumanAd",
};

function formatAmount(resource: UsageResource, value: number): string {
  if (resource === "BLOB_UPLOAD_BYTES") {
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(0)} MB`;
    }
    return `${Math.round(value / 1024)} KB`;
  }
  return String(value);
}

function meterPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function UsageDashboard({
  persona,
  initial,
  upgraded,
  stripeEnabled = false,
}: {
  persona: "personal" | "business";
  initial: UsagePayload;
  upgraded?: boolean;
  stripeEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<UsagePayload>(initial);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchUsageFromApi = useCallback(async (): Promise<UsagePayload> => {
    const res = await fetch("/api/me/usage", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const text = await res.text();
    if (!text.trim()) {
      throw new Error(t("shell.billing.fetchEmpty"));
    }
    let json: UsagePayload & { ok?: boolean; error?: string };
    try {
      json = JSON.parse(text) as UsagePayload & { ok?: boolean; error?: string };
    } catch {
      throw new Error(t("shell.billing.fetchParse"));
    }
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? t("shell.billing.fetchFailed"));
    }
    return json;
  }, [t]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setData(await fetchUsageFromApi());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [fetchUsageFromApi]);

  const subtitle =
    persona === "business"
      ? t("shell.billing.subtitleBusiness")
      : t("shell.billing.subtitlePersonal");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("shell.billing.kicker")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {t("shell.billing.title")}
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
        >
          {refreshing ? t("shell.billing.refreshing") : t("shell.billing.refresh")}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-lg border border-white/10 bg-card/40 px-4 py-3 text-sm">
        <p>
          {t("shell.billing.period")}：
          <span className="font-medium">{data.periodKey}</span>（UTC）
        </p>
        <p className="mt-1 text-muted-foreground">
          {t("shell.billing.plan")}：
          <span className="text-foreground">{data.plan}</span>
          {data.exempt && t("shell.billing.exempt")}
          {!data.enforced && !data.exempt && t("shell.billing.devNotEnforced")}
        </p>
      </div>

      <ul className="space-y-4">
        {data.meters.map((m) => (
          <li
            key={m.resource}
            className="rounded-xl border border-white/10 bg-card/30 p-5"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium">{t(RESOURCE_I18N[m.resource])}</span>
              <span className="text-sm text-muted-foreground">
                {formatAmount(m.resource, m.used)} /{" "}
                {formatAmount(m.resource, m.limit)}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${meterPercent(m.used, m.limit)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("shell.billing.remaining")}{" "}
              {formatAmount(m.resource, m.remaining)}
            </p>
          </li>
        ))}
      </ul>

      {upgraded && (
        <p className="text-sm text-emerald-400">{t("shell.billing.upgraded")}</p>
      )}

      {stripeEnabled && data.plan !== "pro" && persona === "business" && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h2 className="font-semibold">{t("shell.billing.proTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("shell.billing.proBody")}
          </p>
        </div>
      )}

      {stripeEnabled && data.plan === "pro" && (
        <p className="text-sm text-muted-foreground">
          {t("shell.billing.onProPlan")}
        </p>
      )}

      {!stripeEnabled && (
        <p className="max-w-xl text-xs text-muted-foreground">
          {t("shell.billing.freeTierNote")}
        </p>
      )}
    </div>
  );
}
