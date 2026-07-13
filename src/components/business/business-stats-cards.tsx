import type { BusinessInsightsSummary } from "@/lib/services/business-insights-service";
import { Card, CardContent } from "@/components/ui/card";

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
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label} size="sm">
          <CardContent className="space-y-2 pt-2">
            <dt className="text-meta text-muted-foreground">{c.label}</dt>
            <dd className="font-heading text-title font-normal tabular-nums">
              {c.value}
            </dd>
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}
