import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { BusinessStatsCards } from "@/components/business/business-stats-cards";
import { VideoPerformanceTable } from "@/components/business/video-performance-table";
import { getServerTranslator } from "@/i18n/server";
import { loadBusinessInsights } from "@/lib/services/business-insights-service";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/performance");

  const { t, locale } = await getServerTranslator();
  const insights = await loadBusinessInsights(session.user.id, locale).catch(
    () => null,
  );

  return (
    <div className="space-y-8">
      <BusinessPageHeader
        kicker={t("shell.performancePage.kicker")}
        title={t("shell.performancePage.title")}
        subtitle={t("shell.performancePage.subtitle")}
      />

      {insights ? (
        <>
          <BusinessStatsCards
            summary={insights.summary}
            labels={{
              totalVideos: t("shell.statsCards.totalVideos"),
              ready: t("shell.statsCards.ready"),
              inProgress: t("shell.statsCards.inProgress"),
              withMetrics: t("shell.statsCards.withMetrics"),
              totalViews: t("shell.statsCards.totalViews"),
              avgCompletion: t("shell.statsCards.avgCompletion"),
            }}
          />
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              {t("shell.performancePage.videosSection")}
            </h2>
            <VideoPerformanceTable
              videos={insights.videos}
              labels={{
                empty: t("shell.perfTable.empty"),
                createFirst: t("shell.perfTable.createFirst"),
                colVideo: t("shell.perfTable.colVideo"),
                colStatus: t("shell.perfTable.colStatus"),
                colViews: t("shell.perfTable.colViews"),
                colCompletion: t("shell.perfTable.colCompletion"),
                open: t("shell.perfTable.open"),
              }}
            />
          </section>
        </>
      ) : (
        <p className="text-sm text-destructive">
          {t("shell.performancePage.loadError")}
        </p>
      )}
    </div>
  );
}
