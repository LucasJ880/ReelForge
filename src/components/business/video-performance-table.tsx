import Link from "next/link";
import type { BusinessVideoInsight } from "@/lib/services/business-insights-service";

export type PerfTableLabels = {
  empty: string;
  createFirst: string;
  colVideo: string;
  colStatus: string;
  colViews: string;
  colCompletion: string;
  open: string;
};

const STATUS_CLASS: Record<string, string> = {
  ready: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-rose-500/15 text-rose-300",
  generating: "bg-amber-500/15 text-amber-300",
  assembling: "bg-sky-500/15 text-sky-300",
  planning: "bg-slate-500/15 text-slate-300",
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
      <p className="text-sm text-muted-foreground">
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
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-white/10 bg-card/50 text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{labels.colVideo}</th>
            <th className="px-4 py-3 font-medium">{labels.colStatus}</th>
            <th className="px-4 py-3 font-medium">{labels.colViews}</th>
            <th className="px-4 py-3 font-medium">{labels.colCompletion}</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr
              key={v.orderId}
              className="border-b border-white/5 last:border-0"
            >
              <td className="max-w-xs truncate px-4 py-3 font-medium">
                {v.title}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[v.status] ?? STATUS_CLASS.planning}`}
                >
                  {v.statusLabel}
                </span>
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
                <Link
                  href={`/business/products/${v.orderId}`}
                  className="text-primary hover:underline"
                >
                  {labels.open}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
