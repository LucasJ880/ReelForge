import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { RecommendationList } from "@/components/business/recommendation-list";
import { loadBusinessInsights } from "@/lib/services/business-insights-service";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/recommendations");

  const insights = await loadBusinessInsights(session.user.id).catch(() => null);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Next best action
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Recommendations
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Rule-based suggestions from your video library and metrics. Full
          AI-driven creative optimization ships in a later phase.
        </p>
      </header>

      {insights ? (
        <RecommendationList items={insights.recommendations} />
      ) : (
        <p className="text-sm text-destructive">
          Could not load recommendations. Please refresh.
        </p>
      )}
    </div>
  );
}
