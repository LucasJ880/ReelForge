"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n/useTranslation";

export type BusinessVideoMetricOption = {
  orderId: string;
  title: string;
  briefId: string;
};

export function BusinessMetricsForm({
  videos,
}: {
  videos: BusinessVideoMetricOption[];
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [briefId, setBriefId] = useState(videos[0]?.briefId ?? "");
  const [windowHours, setWindowHours] = useState<12 | 24 | 48>(24);
  const [publishUrl, setPublishUrl] = useState("");
  const [views, setViews] = useState("");
  const [completionRate, setCompletionRate] = useState("");
  const [retention3s, setRetention3s] = useState("");
  const [likes, setLikes] = useState("");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (videos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("shell.metricsForm.empty")}
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/business/metrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          briefId,
          windowHours,
          publishUrl: publishUrl.trim() || null,
          metrics: {
            views: views ? Number(views) : undefined,
            completion_rate: completionRate
              ? Number(completionRate)
              : undefined,
            retention_3s: retention3s ? Number(retention3s) : undefined,
            likes: likes ? Number(likes) : undefined,
            comments: comments ? Number(comments) : undefined,
          },
        }),
      });
      const j = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) throw new Error(j.error ?? t("shell.metricsForm.saveError"));
      setMessage(t("shell.metricsForm.saveSuccess"));
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <div>
        <label className="text-meta font-medium text-muted-foreground">
          {t("shell.metricsForm.video")}
          <select
            value={briefId}
            onChange={(e) => setBriefId(e.target.value)}
            className="mt-1 block h-10 w-full rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {videos.map((v) => (
              <option key={v.briefId} value={v.briefId}>
                {v.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-meta font-medium text-muted-foreground">
            {t("shell.metricsForm.window")}
            <select
              value={windowHours}
              onChange={(e) =>
                setWindowHours(Number(e.target.value) as 12 | 24 | 48)
              }
              className="mt-1 block h-10 w-full rounded-(--radius-md) border border-input bg-card px-3 text-body text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value={12}>{t("shell.metricsForm.window12")}</option>
              <option value={24}>{t("shell.metricsForm.window24")}</option>
              <option value={48}>{t("shell.metricsForm.window48")}</option>
            </select>
          </label>
        </div>
        <div>
          <label className="text-meta font-medium text-muted-foreground">
            {t("shell.metricsForm.tiktokUrl")}
            <Input
              type="url"
              value={publishUrl}
              onChange={(e) => setPublishUrl(e.target.value)}
              placeholder={t("shell.metricsForm.tiktokPlaceholder")}
              className="mt-1"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="text-meta font-medium text-muted-foreground">
            {t("shell.metricsForm.views")}
            <Input
              type="number"
              min={0}
              value={views}
              onChange={(e) => setViews(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
        <div>
          <label className="text-meta font-medium text-muted-foreground">
            {t("shell.metricsForm.completion")}
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={completionRate}
              onChange={(e) => setCompletionRate(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
        <div>
          <label className="text-meta font-medium text-muted-foreground">
            {t("shell.metricsForm.retention3s")}
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={retention3s}
              onChange={(e) => setRetention3s(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
        <div>
          <label className="text-meta font-medium text-muted-foreground">
            {t("shell.metricsForm.likes")}
            <Input
              type="number"
              min={0}
              value={likes}
              onChange={(e) => setLikes(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
        <div>
          <label className="text-meta font-medium text-muted-foreground">
            {t("shell.metricsForm.comments")}
            <Input
              type="number"
              min={0}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
      </div>

      {error && <p role="alert" className="text-meta text-danger">{error}</p>}
      {message && <p role="status" className="text-meta text-success">{message}</p>}

      <Button
        type="submit"
        disabled={saving}
      >
        {saving ? t("shell.metricsForm.saving") : t("shell.metricsForm.save")}
      </Button>
    </form>
  );
}
