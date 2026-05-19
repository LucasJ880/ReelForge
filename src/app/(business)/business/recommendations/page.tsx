import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { RecommendationList } from "@/components/business/recommendation-list";
import { getServerTranslator } from "@/i18n/server";
import { loadBusinessInsights } from "@/lib/services/business-insights-service";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/recommendations");

  const { t, locale } = await getServerTranslator();
  const insights = await loadBusinessInsights(session.user.id, locale).catch(
    () => null,
  );

  const listLabels = {
    empty: t("shell.recommendationsPage.empty"),
    priorityHigh: t("shell.recommendationsPage.priorityHigh"),
    priorityMedium: t("shell.recommendationsPage.priorityMedium"),
    priorityLow: t("shell.recommendationsPage.priorityLow"),
  };

  return (
    <div className="space-y-8">
      <BusinessPageHeader
        kicker={t("shell.recommendationsPage.kicker")}
        title={t("shell.recommendationsPage.title")}
        subtitle={t("shell.recommendationsPage.subtitle")}
      />

      {insights ? (
        <RecommendationList
          items={insights.recommendations}
          labels={listLabels}
        />
      ) : (
        <p className="text-sm text-destructive">
          {t("shell.recommendationsPage.loadError")}
        </p>
      )}
    </div>
  );
}
