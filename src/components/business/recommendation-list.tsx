import Link from "next/link";
import type { BusinessRecommendation } from "@/lib/services/business-insights-service";

export type RecommendationListLabels = {
  empty: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;
};

const PRIORITY_CLASS: Record<BusinessRecommendation["priority"], string> = {
  high: "bg-rose-500/15 text-rose-300",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-slate-500/15 text-slate-300",
};

function priorityLabel(
  priority: BusinessRecommendation["priority"],
  labels: RecommendationListLabels,
): string {
  if (priority === "high") return labels.priorityHigh;
  if (priority === "medium") return labels.priorityMedium;
  return labels.priorityLow;
}

export function RecommendationList({
  items,
  labels,
}: {
  items: BusinessRecommendation[];
  labels: RecommendationListLabels;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{labels.empty}</p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-white/10 bg-card/30 p-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_CLASS[item.priority]}`}
            >
              {priorityLabel(item.priority, labels)}
            </span>
            <h3 className="font-medium">{item.title}</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
          <Link
            href={item.actionHref}
            className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
          >
            {item.actionLabel} →
          </Link>
        </li>
      ))}
    </ul>
  );
}
