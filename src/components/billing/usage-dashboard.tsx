"use client";

import { useCallback, useState } from "react";
import type { UsageResource } from "@prisma/client";
import { USAGE_RESOURCE_LABELS } from "@/lib/config/quota-tiers";
import type { UsagePayload } from "@/lib/services/usage-payload";

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

async function fetchUsageFromApi(): Promise<UsagePayload> {
  const res = await fetch("/api/me/usage", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const text = await res.text();
  if (!text.trim()) {
    throw new Error("服务器返回空响应，请刷新页面重试");
  }
  let json: UsagePayload & { ok?: boolean; error?: string };
  try {
    json = JSON.parse(text) as UsagePayload & { ok?: boolean; error?: string };
  } catch {
    throw new Error("无法解析用量数据，请稍后重试");
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? "无法加载用量");
  }
  return json;
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
  /** 投资人前暂不启用 Stripe 时传 false */
  stripeEnabled?: boolean;
}) {
  const [data, setData] = useState<UsagePayload>(initial);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
  }, []);

  const subtitle =
    persona === "business"
      ? "免费档月度额度（UTC 自然月）。超额后需等待下月重置或联系升级。"
      : "免费档月度额度（UTC 自然月）。超额后需等待下月重置。";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            用量
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            用量与账单
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-lg border border-white/10 bg-card/40 px-4 py-3 text-sm">
        <p>
          计费周期：<span className="font-medium">{data.periodKey}</span>（UTC）
        </p>
        <p className="mt-1 text-muted-foreground">
          套餐：<span className="text-foreground">{data.plan}</span>
          {data.exempt && " · 内部账号不限额"}
          {!data.enforced && !data.exempt && " · 开发环境未强制限额"}
        </p>
      </div>

      <ul className="space-y-4">
        {data.meters.map((m) => (
          <li
            key={m.resource}
            className="rounded-xl border border-white/10 bg-card/30 p-5"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium">
                {USAGE_RESOURCE_LABELS[m.resource]}
              </span>
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
              剩余 {formatAmount(m.resource, m.remaining)}
            </p>
          </li>
        ))}
      </ul>

      {upgraded && (
        <p className="text-sm text-emerald-400">
          支付成功！Pro 额度将在几秒内生效，可点击刷新查看。
        </p>
      )}

      {stripeEnabled && data.plan !== "pro" && persona === "business" && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h2 className="font-semibold">Aivora Pro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            更高月度额度：200 次视频生成、600 次方案预览、10GB 上传、400 段 AI 画面。
          </p>
        </div>
      )}

      {stripeEnabled && data.plan === "pro" && (
        <p className="text-sm text-muted-foreground">您当前为 Pro 套餐。</p>
      )}

      {!stripeEnabled && (
        <p className="max-w-xl text-xs text-muted-foreground">
          Pro 付费套餐将在正式上线时开放；当前为免费档月度额度。
        </p>
      )}
    </div>
  );
}
