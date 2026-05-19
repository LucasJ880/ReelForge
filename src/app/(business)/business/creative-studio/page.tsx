import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { getServerTranslator } from "@/i18n/server";
import { loadBusinessInsights } from "@/lib/services/business-insights-service";

export const dynamic = "force-dynamic";

export default async function CreativeStudioPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/creative-studio");

  const { t, locale } = await getServerTranslator();
  const insights = await loadBusinessInsights(session.user.id, locale).catch(
    () => null,
  );
  const ready = insights?.videos.filter((v) => v.status === "ready") ?? [];
  const recent = insights?.videos.slice(0, 8) ?? [];

  return (
    <div className="space-y-8">
      <BusinessPageHeader
        kicker={t("shell.studio.kicker")}
        title={t("shell.studio.title")}
        subtitle={t("shell.studio.subtitle")}
      />

      <div className="rounded-xl border border-white/10 bg-card/30 p-6 shadow-sm">
        <h2 className="font-semibold">{t("shell.studio.quickActions")}</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/business/create-ad-video"
            className="inline-flex rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
          >
            {t("shell.studio.newFromScratch")}
          </Link>
          {ready[0] && (
            <Link
              href={`/business/create-ad-video?from=${encodeURIComponent(ready[0].orderId)}`}
              className="inline-flex rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
            >
              {t("shell.studio.variantLatest")}
            </Link>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("shell.studio.recentProducts")}</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("shell.studio.emptyRecent")}
          </p>
        ) : (
          <ul className="space-y-2">
            {recent.map((v) => (
              <li
                key={v.orderId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-card/20 px-4 py-3 transition-colors hover:border-white/15 hover:bg-card/35"
              >
                <div>
                  <p className="max-w-md truncate font-medium">{v.title}</p>
                  {v.hook ? (
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {t("shell.studio.hookPrefix")}: {v.hook}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-3 text-sm">
                  <Link
                    href={`/business/products/${v.orderId}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t("shell.studio.view")}
                  </Link>
                  <Link
                    href={`/business/create-ad-video?from=${encodeURIComponent(v.orderId)}`}
                    className="text-primary hover:underline"
                  >
                    {t("shell.studio.newVariant")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
