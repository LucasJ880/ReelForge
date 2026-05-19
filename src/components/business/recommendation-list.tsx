import Link from "next/link";
import type { BusinessRecommendation } from "@/lib/services/business-insights-service";

const PRIORITY_CLASS: Record<BusinessRecommendation["priority"], string> = {
  high: "bg-rose-500/15 text-rose-300",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-slate-500/15 text-slate-300",
};

export function RecommendationList({
  items,
}: {
  items: BusinessRecommendation[];
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recommendations yet — create a video to get started.
      </p>
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
              {item.priority}
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
