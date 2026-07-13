import Link from "next/link";
import type { BusinessVideoInsight } from "@/lib/services/business-insights-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type PerfTableLabels = {
  empty: string;
  createFirst: string;
  colVideo: string;
  colStatus: string;
  colViews: string;
  colCompletion: string;
  open: string;
};

const STATUS_VARIANT: Record<
  string,
  "success" | "destructive" | "warning" | "default" | "secondary"
> = {
  ready: "success",
  failed: "destructive",
  generating: "warning",
  assembling: "default",
  planning: "secondary",
};

export function VideoPerformanceTable({
  videos,
  labels,
}: {
  videos: BusinessVideoInsight[];
  labels: PerfTableLabels;
}) {
  if (videos.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        {labels.empty}{" "}
        <Link
          href="/business/create-ad-video"
          className="text-primary hover:underline"
        >
          {labels.createFirst}
        </Link>
        .
      </p>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-(--radius-lg) border border-border bg-card shadow-editorial focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      role="region"
      aria-label={labels.colVideo}
      tabIndex={0}
    >
      <table className="w-full min-w-160 text-left text-body">
        <thead className="border-b border-border bg-muted text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">{labels.colVideo}</th>
            <th scope="col" className="px-4 py-3 font-medium">{labels.colStatus}</th>
            <th scope="col" className="px-4 py-3 font-medium">{labels.colViews}</th>
            <th scope="col" className="px-4 py-3 font-medium">{labels.colCompletion}</th>
            <th scope="col" className="px-4 py-3 font-medium">
              <span className="sr-only">{labels.open}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr
              key={v.orderId}
              className="border-b border-border last:border-0"
            >
              <td className="max-w-xs truncate px-4 py-3 font-medium">
                {v.title}
              </td>
              <td className="px-4 py-3">
                <Badge variant={STATUS_VARIANT[v.status] ?? "secondary"}>
                  {v.statusLabel}
                </Badge>
              </td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground">
                {v.views != null ? v.views.toLocaleString() : "—"}
              </td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground">
                {v.completionRate != null
                  ? `${Math.round(v.completionRate * 100)}%`
                  : "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  render={<Link href={`/business/products/${v.orderId}`} />}
                  variant="link"
                  size="sm"
                  className="px-0"
                >
                  {labels.open}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
