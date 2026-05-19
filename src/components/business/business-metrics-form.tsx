"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
        还没有可录入数据的已出片视频。先在 Create Ad Video 完成一条视频。
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
      if (!res.ok) throw new Error(j.error ?? "保存失败");
      setMessage("数据已保存，Performance 与 Recommendations 将自动更新。");
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
        <label className="text-xs text-muted-foreground">视频</label>
        <select
          value={briefId}
          onChange={(e) => setBriefId(e.target.value)}
          className="mt-1 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm"
        >
          {videos.map((v) => (
            <option key={v.briefId} value={v.briefId}>
              {v.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">统计窗口</label>
          <select
            value={windowHours}
            onChange={(e) =>
              setWindowHours(Number(e.target.value) as 12 | 24 | 48)
            }
            className="mt-1 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm"
          >
            <option value={12}>发布后 12 小时</option>
            <option value={24}>发布后 24 小时</option>
            <option value={48}>发布后 48 小时</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            TikTok 链接（可选）
          </label>
          <input
            type="url"
            value={publishUrl}
            onChange={(e) => setPublishUrl(e.target.value)}
            placeholder="https://www.tiktok.com/@…/video/…"
            className="mt-1 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="text-xs text-muted-foreground">播放量</label>
          <input
            type="number"
            min={0}
            value={views}
            onChange={(e) => setViews(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            完播率 (0–1)
          </label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={completionRate}
            onChange={(e) => setCompletionRate(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            3 秒留存 (0–1)
          </label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={retention3s}
            onChange={(e) => setRetention3s(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">点赞</label>
          <input
            type="number"
            min={0}
            value={likes}
            onChange={(e) => setLikes(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">评论</label>
          <input
            type="number"
            min={0}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? "保存中…" : "保存指标"}
      </button>
    </form>
  );
}
