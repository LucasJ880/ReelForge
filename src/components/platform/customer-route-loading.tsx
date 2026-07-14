import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import type { CustomerRouteId } from "./customer-route-state";

export async function CustomerRouteLoading({
  route,
}: {
  route: CustomerRouteId;
}) {
  const copy = getPlatformCopy(await getServerLocale()).routeStates;
  const area = copy.areas[route];

  return (
    <section
      data-route-state="loading"
      data-customer-route={route}
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="editorial-page-stack min-w-0"
    >
      <span className="sr-only">{copy.loading.replace("{area}", area)}</span>
      <header className="max-w-3xl space-y-3" aria-hidden="true">
        <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
        <Skeleton className="h-10 w-full max-w-xl motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full max-w-2xl motion-reduce:animate-none" />
      </header>
      {(route === "batches" || route === "batchDetail") && (
        <Progress
          value={0}
          aria-label={copy.batchProgress}
          className="max-w-3xl"
        />
      )}
      <div
        className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"
        aria-hidden="true"
      >
        {Array.from({ length: route === "batchDetail" ? 2 : 4 }, (_, index) => (
          <div
            key={index}
            className="space-y-4 rounded-(--radius-lg) border border-border bg-card p-5"
          >
            <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
            <Skeleton className="h-7 w-4/5 motion-reduce:animate-none" />
            <Skeleton className="h-24 w-full motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </section>
  );
}
