import type { BusinessInsightsSummary } from "@/lib/services/business-insights-service";

export function BusinessStatsCards({
  summary,
}: {
  summary: BusinessInsightsSummary;
}) {
  const cards = [
    { label: "Total videos", value: summary.totalVideos },
    { label: "Ready", value: summary.readyCount },
    { label: "In progress", value: summary.inProgressCount },
    { label: "With metrics", value: summary.withMetricsCount },
    {
      label: "Total views",
      value: summary.totalViews > 0 ? summary.totalViews.toLocaleString() : "—",
    },
    {
      label: "Avg completion",
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
          className="rounded-xl border border-white/10 bg-card/30 px-4 py-4"
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
