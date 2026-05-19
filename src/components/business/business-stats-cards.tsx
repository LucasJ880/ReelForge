import type { BusinessInsightsSummary } from "@/lib/services/business-insights-service";

export type StatsCardLabels = {
  totalVideos: string;
  ready: string;
  inProgress: string;
  withMetrics: string;
  totalViews: string;
  avgCompletion: string;
};

export function BusinessStatsCards({
  summary,
  labels,
}: {
  summary: BusinessInsightsSummary;
  labels: StatsCardLabels;
}) {
  const cards = [
    { label: labels.totalVideos, value: summary.totalVideos },
    { label: labels.ready, value: summary.readyCount },
    { label: labels.inProgress, value: summary.inProgressCount },
    { label: labels.withMetrics, value: summary.withMetricsCount },
    {
      label: labels.totalViews,
      value: summary.totalViews > 0 ? summary.totalViews.toLocaleString() : "—",
    },
    {
      label: labels.avgCompletion,
      value:
        summary.avgCompletionRate != null
          ? `${Math.round(summary.avgCompletionRate * 100)}%`
          : "—",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-white/10 bg-card/30 px-4 py-4 transition-colors hover:border-white/15 hover:bg-card/50"
        >
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {c.label}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</p>
        </div>
      ))}
    </div>
  );
}
