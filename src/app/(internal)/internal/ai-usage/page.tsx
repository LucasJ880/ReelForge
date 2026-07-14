import Link from "next/link";
import { requirePageRole } from "@/lib/api-auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getAIUsageStats,
  getRecentAIUsage,
  KNOWN_AI_FEATURES,
} from "@/lib/services/ai-usage-stats-service";
import type { AIUsageStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<
  AIUsageStatus,
  { label: string; variant: "success" | "destructive" | "warning" }
> = {
  SUCCESS: {
    label: "SUCCESS",
    variant: "success",
  },
  FAILED: {
    label: "FAILED",
    variant: "destructive",
  },
  MOCK: {
    label: "MOCK",
    variant: "warning",
  },
};

export default async function AdminAIUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string; status?: string; days?: string }>;
}) {
  await requirePageRole(["SUPER_ADMIN", "OPERATOR"]);
  const sp = await searchParams;
  const feature = sp.feature && KNOWN_AI_FEATURES.includes(sp.feature as never) ? sp.feature : null;
  const status =
    sp.status && (["SUCCESS", "FAILED", "MOCK"] as const).includes(sp.status as never)
      ? (sp.status as AIUsageStatus)
      : null;
  const windowDays = clampWindowDays(sp.days);

  const [stats, recent] = await Promise.all([
    getAIUsageStats({ feature, status, windowDays }),
    getRecentAIUsage({ feature, status, windowDays }, 50),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-3 border-b border-border pb-6">
        <h1 className="editorial-display">AI Usage Dashboard</h1>
        <p className="max-w-3xl text-body text-muted-foreground">
          内部只读 · 最近 {stats.windowDays} 天 OpenAI 调用统计（{stats.totals.calls} 条记录）。
          数据来源 <code className="font-mono text-meta">AIUsageLog</code>，不参与计费，仅做可观测。
        </p>
      </header>

      <FilterBar feature={feature} status={status} windowDays={windowDays} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Calls" value={String(stats.totals.calls)} />
        <KpiCard
          label="Success / Mock / Failed"
          value={`${stats.totals.successCalls} · ${stats.totals.mockCalls} · ${stats.totals.failedCalls}`}
        />
        <KpiCard
          label="Estimated Cost (USD)"
          value={`$${stats.totals.totalCostUsd.toFixed(4)}`}
        />
        <KpiCard label="Total Tokens" value={String(stats.totals.totalTokens)} />
      </section>

      <section className="grid min-w-0 gap-4 2xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Calls by Feature</CardTitle>
          </CardHeader>
          <CardContent className="text-meta">
            {stats.byFeature.length === 0 ? (
              <p className="text-muted-foreground">所选窗口内无调用记录。</p>
            ) : (
              <div
                className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                role="region"
                aria-label="按功能统计的 AI 调用"
                tabIndex={0}
              >
              <table className="min-w-160 w-full">
                <thead className="text-meta text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1.5">Feature</th>
                    <th className="py-1.5 text-right">Calls</th>
                    <th className="py-1.5 text-right">Success</th>
                    <th className="py-1.5 text-right">Failed</th>
                    <th className="py-1.5 text-right">Mock</th>
                    <th className="py-1.5 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byFeature.map((row) => (
                    <tr
                      key={row.feature}
                      className="border-t border-border"
                    >
                      <td className="py-1.5 font-mono text-meta">
                        {row.feature}
                      </td>
                      <td className="py-1.5 text-right">{row.calls}</td>
                      <td className="py-1.5 text-right text-success">
                        {row.successCalls}
                      </td>
                      <td className="py-1.5 text-right text-danger">
                        {row.failedCalls}
                      </td>
                      <td className="py-1.5 text-right text-warning">
                        {row.mockCalls}
                      </td>
                      <td className="py-1.5 text-right">
                        ${row.costUsd.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Calls by Model</CardTitle>
          </CardHeader>
          <CardContent className="text-meta">
            {stats.byModel.length === 0 ? (
              <p className="text-muted-foreground">所选窗口内无调用记录。</p>
            ) : (
              <div
                className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                role="region"
                aria-label="按模型统计的 AI 调用"
                tabIndex={0}
              >
              <table className="min-w-128 w-full">
                <thead className="text-meta text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1.5">Model</th>
                    <th className="py-1.5 text-right">Calls</th>
                    <th className="py-1.5 text-right">Prompt Tok</th>
                    <th className="py-1.5 text-right">Compl Tok</th>
                    <th className="py-1.5 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byModel.map((row) => (
                    <tr key={row.model} className="border-t border-border">
                      <td className="py-1.5 font-mono text-meta">
                        {row.model}
                      </td>
                      <td className="py-1.5 text-right">{row.calls}</td>
                      <td className="py-1.5 text-right">{row.promptTokens}</td>
                      <td className="py-1.5 text-right">
                        {row.completionTokens}
                      </td>
                      <td className="py-1.5 text-right">
                        ${row.costUsd.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent 50 Calls</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-meta text-muted-foreground">所选窗口内没有调用记录。</p>
          ) : (
            <div
              className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              role="region"
              aria-label="最近 50 次 AI 调用"
              tabIndex={0}
            >
              <table className="min-w-180 w-full text-meta">
                <thead className="text-meta text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1.5">Time</th>
                    <th className="py-1.5">Feature</th>
                    <th className="py-1.5">Model</th>
                    <th className="py-1.5">Status</th>
                    <th className="py-1.5 text-right">Tokens</th>
                    <th className="py-1.5 text-right">Cost</th>
                    <th className="py-1.5 text-right">Duration</th>
                    <th className="py-1.5">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => {
                    const s = STATUS_LABEL[r.status];
                    return (
                      <tr key={r.id} className="border-t border-border align-top">
                        <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                          {r.createdAt.toLocaleString()}
                        </td>
                        <td className="py-1.5 font-mono text-meta">
                          {r.feature}
                        </td>
                        <td className="py-1.5 font-mono text-meta">
                          {r.model ?? "-"}
                        </td>
                        <td className="py-1.5">
                          <Badge variant={s.variant}>{s.label}</Badge>
                          {r.errorMessage && (
                            <div className="mt-1 max-w-[28ch] truncate text-meta text-danger">
                              {r.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 text-right">{r.totalTokens ?? 0}</td>
                        <td className="py-1.5 text-right">
                          {r.costEstimateUsd != null
                            ? `$${r.costEstimateUsd.toFixed(4)}`
                            : "-"}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {r.durationMs != null ? `${r.durationMs}ms` : "-"}
                        </td>
                        <td className="py-1.5">
                          {r.deliveryOrderId ? (
                            <Link
                              href={`/internal/orders/${r.deliveryOrderId}`}
                              className="text-primary hover:underline"
                            >
                              {r.deliveryOrderTitle ?? r.deliveryOrderId.slice(0, 6)}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <div className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="font-heading text-title">{value}</div>
      </CardContent>
    </Card>
  );
}

function FilterBar({
  feature,
  status,
  windowDays,
}: {
  feature: string | null;
  status: AIUsageStatus | null;
  windowDays: number;
}) {
  const buildHref = (params: Partial<{ feature: string | null; status: string | null; days: number }>) => {
    const sp = new URLSearchParams();
    const f = params.feature !== undefined ? params.feature : feature;
    const s = params.status !== undefined ? params.status : status;
    const d = params.days !== undefined ? params.days : windowDays;
    if (f) sp.set("feature", f);
    if (s) sp.set("status", s);
    sp.set("days", String(d));
    const q = sp.toString();
    return `/admin/ai-usage${q ? "?" + q : ""}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-meta">
      <span className="text-muted-foreground">Feature：</span>
      <Link
        href={buildHref({ feature: null })}
        className={chip(!feature)}
      >
        全部
      </Link>
      {KNOWN_AI_FEATURES.map((f) => (
        <Link key={f} href={buildHref({ feature: f })} className={chip(feature === f)}>
          {f}
        </Link>
      ))}
      <span className="mx-2 text-muted-foreground">·</span>
      <span className="text-muted-foreground">Status：</span>
      <Link href={buildHref({ status: null })} className={chip(!status)}>
        全部
      </Link>
      {(["SUCCESS", "FAILED", "MOCK"] as const).map((st) => (
        <Link key={st} href={buildHref({ status: st })} className={chip(status === st)}>
          {st}
        </Link>
      ))}
      <span className="mx-2 text-muted-foreground">·</span>
      <span className="text-muted-foreground">窗口：</span>
      {[7, 30, 90].map((d) => (
        <Link key={d} href={buildHref({ days: d })} className={chip(windowDays === d)}>
          {d}d
        </Link>
      ))}
    </div>
  );
}

function chip(active: boolean) {
  return [
    "inline-flex min-h-10 items-center rounded-(--radius-md) border px-3 text-meta font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    active
      ? "bg-foreground text-background border-foreground"
      : "border-border bg-card text-muted-foreground hover:border-foreground hover:text-foreground",
  ].join(" ");
}

function clampWindowDays(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30;
  if (n > 365) return 365;
  return Math.floor(n);
}
