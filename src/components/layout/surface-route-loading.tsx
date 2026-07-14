import { Skeleton } from "@/components/ui/skeleton";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export type SurfaceRouteArea = "public" | "internal";

export async function SurfaceRouteLoading({
  area,
}: {
  area: SurfaceRouteArea;
}) {
  const copy = getPlatformCopy(await getServerLocale()).routeStates;
  const areaLabel = copy.areas[area];

  return (
    <section
      data-route-state="loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto w-full max-w-7xl space-y-6 px-4 py-10 text-foreground sm:px-8"
    >
      <span className="sr-only">
        {copy.loading.replace("{area}", areaLabel)}
      </span>
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
        <Skeleton className="h-10 w-full max-w-xl motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full max-w-2xl motion-reduce:animate-none" />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="space-y-4 rounded-(--radius-lg) border border-border bg-card p-5"
          >
            <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
            <Skeleton className="h-7 w-4/5 motion-reduce:animate-none" />
            <Skeleton className="h-20 w-full motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </section>
  );
}
