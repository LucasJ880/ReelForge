import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BusinessStatsCards } from "@/components/business/business-stats-cards";
import { VideoPerformanceTable } from "@/components/business/video-performance-table";
import { loadBusinessInsights } from "@/lib/services/business-insights-service";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/performance");

  const insights = await loadBusinessInsights(session.user.id).catch(() => null);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Analytics
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Performance
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Per-video status and platform metrics when you import CSV or connect
          integrations. Without metrics, you still see production progress.
        </p>
      </header>

      {insights ? (
        <>
          <BusinessStatsCards summary={insights.summary} />
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Videos</h2>
            <VideoPerformanceTable videos={insights.videos} />
          </section>
        </>
      ) : (
        <p className="text-sm text-destructive">
          Could not load performance data. Please refresh.
        </p>
      )}
    </div>
  );
}
