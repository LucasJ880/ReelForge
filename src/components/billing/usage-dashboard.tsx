"use client";

import { useCallback, useState } from "react";
import type { UsageResource } from "@prisma/client";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
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
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-3xl space-y-4">
          <Badge variant="secondary">{t("shell.billing.kicker")}</Badge>
          <h1 className="editorial-display">{t("shell.billing.title")}</h1>
          <p className="max-w-2xl text-body text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
          {refreshing ? t("shell.billing.refreshing") : t("shell.billing.refresh")}
        </Button>
      </header>

      {error && <p role="alert" className="text-meta text-danger">{error}</p>}

      <Card size="sm">
        <CardContent className="grid gap-4 pt-2 sm:grid-cols-2">
          <div>
            <p className="text-meta text-muted-foreground">{t("shell.billing.period")}</p>
            <p className="text-body font-medium">{data.periodKey}（UTC）</p>
          </div>
          <div>
            <p className="text-meta text-muted-foreground">{t("shell.billing.plan")}</p>
            <p className="text-body font-medium">
              {data.plan}
              {data.exempt && t("shell.billing.exempt")}
              {!data.enforced && !data.exempt && t("shell.billing.devNotEnforced")}
            </p>
          </div>
        </CardContent>
      </Card>

      <ul className="grid gap-5 lg:grid-cols-2">
        {data.meters.map((m) => (
          <li key={m.resource}>
            <Card className="h-full" size="sm">
              <CardHeader>
                <CardTitle>{t(RESOURCE_I18N[m.resource])}</CardTitle>
                <CardDescription>
                  {t("shell.billing.remaining")} {formatAmount(m.resource, m.remaining)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={meterPercent(m.used, m.limit)}>
                  <ProgressLabel>
                    {formatAmount(m.resource, m.used)} / {formatAmount(m.resource, m.limit)}
                  </ProgressLabel>
                  <ProgressValue />
                </Progress>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {upgraded && (
        <Badge variant="success">{t("shell.billing.upgraded")}</Badge>
      )}

      {stripeEnabled && data.plan !== "pro" && persona === "business" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("shell.billing.proTitle")}</CardTitle>
            <CardDescription>{t("shell.billing.proBody")}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {stripeEnabled && data.plan === "pro" && (
        <p className="text-meta text-muted-foreground">
          {t("shell.billing.onProPlan")}
        </p>
      )}

      {!stripeEnabled && (
        <p className="max-w-xl text-meta text-muted-foreground">
          {t("shell.billing.freeTierNote")}
        </p>
      )}
    </div>
  );
}
