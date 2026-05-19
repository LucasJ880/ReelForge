import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { BusinessMetricsForm } from "@/components/business/business-metrics-form";
import { authOptions } from "@/lib/auth";
import { getServerTranslator } from "@/i18n/server";
import { listBusinessVideosForMetrics } from "@/lib/services/business-metrics-import";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/integrations");

  const { t } = await getServerTranslator();
  const videos =
    session.user?.id != null
      ? await listBusinessVideosForMetrics(session.user.id)
      : [];

  const platforms = [
    {
      id: "tiktok",
      name: "TikTok",
      status: "manual" as const,
      description: t("shell.integrations.tiktokDesc"),
    },
    {
      id: "shopify",
      name: "Shopify",
      status: "planned" as const,
      description: t("shell.integrations.shopifyDesc"),
    },
    {
      id: "meta",
      name: "Meta Ads",
      status: "planned" as const,
      description: t("shell.integrations.metaDesc"),
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("shell.integrations.kicker")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("shell.integrations.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {t("shell.integrations.subtitle")}
        </p>
      </header>

      <section className="rounded-xl border border-white/10 bg-card/30 p-6">
        <h2 className="text-lg font-semibold">
          {t("shell.integrations.metricsTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("shell.integrations.metricsSubtitle")}
        </p>
        <div className="mt-6">
          <BusinessMetricsForm videos={videos} />
        </div>
      </section>

      <ul className="space-y-3">
        {platforms.map((p) => (
          <li
            key={p.id}
            className="rounded-xl border border-white/10 bg-card/30 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{p.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.description}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  p.status === "manual"
                    ? "bg-sky-500/15 text-sky-300"
                    : "bg-slate-500/15 text-slate-400"
                }`}
              >
                {p.status === "manual"
                  ? t("shell.integrations.statusSelfServe")
                  : t("shell.badgeSoon")}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-dashed border-white/15 bg-card/20 p-6 text-sm text-muted-foreground">
        <p>
          {t("shell.integrations.footer")}{" "}
          <Link
            href="/business/performance"
            className="text-primary hover:underline"
          >
            {t("shell.businessNav.performance")}
          </Link>
          {" · "}
          <Link
            href="/business/recommendations"
            className="text-primary hover:underline"
          >
            {t("shell.businessNav.recommendations")}
          </Link>
        </p>
      </div>
    </div>
  );
}
