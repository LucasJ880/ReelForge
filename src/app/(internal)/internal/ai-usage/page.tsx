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

const STATUS_LABEL: Record<AIUsageStatus, { label: string; cls: string }> = {
  SUCCESS: {
    label: "SUCCESS",
    cls: "bg-emerald-500/15 border border-emerald-400/30 text-emerald-200",
  },
  FAILED: {
    label: "FAILED",
    cls: "bg-rose-500/15 border border-rose-400/30 text-rose-200",
  },
  MOCK: {
    label: "MOCK",
    cls: "bg-amber-500/15 border border-amber-400/30 text-amber-200",
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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">AI Usage Dashboard</h1>
        <p className="text-xs text-muted-foreground">
          内部只读 · 最近 {stats.windowDays} 天 OpenAI 调用统计（{stats.totals.calls} 条记录）。
          数据来源 <code className="text-[10px]">AIUsageLog</code>，不参与计费，仅做可观测。
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

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Calls by Feature</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            {stats.byFeature.length === 0 ? (
              <p className="text-muted-foreground">所选窗口内无调用记录。</p>
            ) : (
              <table className="w-full">
                <thead className="text-[10px] text-muted-foreground">
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
                      className="border-t border-white/5"
                    >
                      <td className="py-1.5 font-mono text-[11px]">
                        {row.feature}
                      </td>
                      <td className="py-1.5 text-right">{row.calls}</td>
                      <td className="py-1.5 text-right text-emerald-300">
                        {row.successCalls}
                      </td>
                      <td className="py-1.5 text-right text-rose-300">
                        {row.failedCalls}
                      </td>
                      <td className="py-1.5 text-right text-amber-300">
                        {row.mockCalls}
                      </td>
                      <td className="py-1.5 text-right">
                        ${row.costUsd.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Calls by Model</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            {stats.byModel.length === 0 ? (
              <p className="text-muted-foreground">所选窗口内无调用记录。</p>
            ) : (
              <table className="w-full">
                <thead className="text-[10px] text-muted-foreground">
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
                    <tr key={row.model} className="border-t border-white/5">
                      <td className="py-1.5 font-mono text-[11px]">
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
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent 50 Calls</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">所选窗口内没有调用记录。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[720px]">
                <thead className="text-[10px] text-muted-foreground">
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
                      <tr key={r.id} className="border-t border-white/5 align-top">
                        <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                          {r.createdAt.toLocaleString()}
                        </td>
                        <td className="py-1.5 font-mono text-[11px]">
                          {r.feature}
                        </td>
                        <td className="py-1.5 font-mono text-[11px]">
                          {r.model ?? "-"}
                        </td>
                        <td className="py-1.5">
                          <Badge className={`${s.cls} text-[10px]`}>{s.label}</Badge>
                          {r.errorMessage && (
                            <div className="text-[10px] text-rose-300/80 mt-0.5 max-w-[28ch] truncate">
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
                              className="text-sky-300 hover:underline"
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
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-xl font-semibold">{value}</div>
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
    <div className="flex flex-wrap items-center gap-2 text-xs">
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
    "rounded px-2 py-0.5 border text-[11px]",
    active
      ? "bg-foreground text-background border-foreground"
      : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/30",
  ].join(" ");
}

function clampWindowDays(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30;
  if (n > 365) return 365;
  return Math.floor(n);
}
