import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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
      <header>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("shell.recommendationsPage.kicker")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("shell.recommendationsPage.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {t("shell.recommendationsPage.subtitle")}
        </p>
      </header>

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
