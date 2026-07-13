import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { BusinessRecommendation } from "@/lib/services/business-insights-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type RecommendationListLabels = {
  empty: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;
};

const PRIORITY_VARIANT: Record<
  BusinessRecommendation["priority"],
  "destructive" | "warning" | "secondary"
> = {
  high: "destructive",
  medium: "warning",
  low: "secondary",
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
      <p className="text-body text-muted-foreground">{labels.empty}</p>
    );
  }

  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {items.map((item) => (
        <li key={item.id}>
          <Card className="h-full" size="sm">
            <CardContent className="flex h-full flex-col gap-4 pt-2">
              <div className="space-y-3">
                <Badge variant={PRIORITY_VARIANT[item.priority]}>
                  {priorityLabel(item.priority, labels)}
                </Badge>
                <h3 className="font-heading text-subhead font-normal">
                  {item.title}
                </h3>
                <p className="text-body text-muted-foreground">{item.body}</p>
              </div>
              <Button
                render={<Link href={item.actionHref} />}
                variant="link"
                className="mt-auto w-fit px-0"
              >
                {item.actionLabel}
                <ArrowRight strokeWidth={1.5} aria-hidden />
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
