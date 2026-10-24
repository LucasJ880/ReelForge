import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_ROUTE_WALL_CELLS,
  type CustomerRouteId,
} from "./customer-route-state";

const WALL_COLUMNS: Record<number, string> = {
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "sm:grid-cols-3 lg:grid-cols-6",
};

/**
 * 加载骨架按行情头的结构画（1025 · B2）：大标题 → 副标题 → 读数墙（格数与该页一致）→ 口径行 → 正文面板。
 * 不画眉题短条——真实页面没有眉题，骨架画了就会在切页时跳一下。
 */
export async function CustomerRouteLoading({
  route,
}: {
  route: CustomerRouteId;
}) {
  const copy = getPlatformCopy(await getServerLocale()).routeStates;
  const area = copy.areas[route];
  const cells = CUSTOMER_ROUTE_WALL_CELLS[route];

  return (
    <section
      data-route-state="loading"
      data-customer-route={route}
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="x-stack min-w-0"
    >
      <span className="sr-only">{copy.loading.replace("{area}", area)}</span>
      <header className="space-y-6" aria-hidden="true" data-skeleton="quote-header">
        <div className="max-w-4xl space-y-3">
          <Skeleton className="h-11 w-full max-w-sm motion-reduce:animate-none" />
          <Skeleton className="h-4 w-full max-w-[62ch] motion-reduce:animate-none" />
          <Skeleton className="h-4 w-3/5 max-w-[40ch] motion-reduce:animate-none" />
        </div>
        <div className="space-y-2">
          <div className={cn("x-wall grid-cols-2", WALL_COLUMNS[cells])} data-skeleton="readings">
            {Array.from({ length: cells }, (_, index) => (
              <div key={index} className="space-y-3 px-5 py-4">
                <Skeleton className="h-2.5 w-20 motion-reduce:animate-none" />
                <Skeleton className="h-8 w-14 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
          <Skeleton className="h-3 w-full max-w-md motion-reduce:animate-none" />
        </div>
      </header>
      {(route === "batches" || route === "batchDetail") && (
        <Progress
          value={0}
          aria-label={copy.batchProgress}
          className="max-w-3xl"
        />
      )}
      <div className="x-panel min-w-0 space-y-4 p-5" aria-hidden="true">
        <Skeleton className="h-4 w-1/4 motion-reduce:animate-none" />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full motion-reduce:animate-none" />
        ))}
      </div>
    </section>
  );
}
