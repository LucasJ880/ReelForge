import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("shell.studio.quickActions")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            render={<Link href="/business/create-ad-video" />}
          >
            {t("shell.studio.newFromScratch")}
          </Button>
          {ready[0] && (
            <Button
              render={
                <Link
                  href={`/business/create-ad-video?from=${encodeURIComponent(ready[0].orderId)}`}
                />
              }
              variant="outline"
            >
              {t("shell.studio.variantLatest")}
            </Button>
          )}
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="font-heading text-subhead font-normal">
          {t("shell.studio.recentProducts")}
        </h2>
        {recent.length === 0 ? (
          <p className="text-body text-muted-foreground">
            {t("shell.studio.emptyRecent")}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-(--radius-lg) border border-border bg-card shadow-editorial">
            {recent.map((v) => (
              <li
                key={v.orderId}
                className="flex min-w-0 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">{v.title}</p>
                  {v.hook ? (
                    <p className="mt-1 line-clamp-1 text-meta text-muted-foreground">
                      {t("shell.studio.hookPrefix")}: {v.hook}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    render={<Link href={`/business/products/${v.orderId}`} />}
                    variant="ghost"
                    size="sm"
                  >
                    {t("shell.studio.view")}
                  </Button>
                  <Button
                    render={
                      <Link
                        href={`/business/create-ad-video?from=${encodeURIComponent(v.orderId)}`}
                      />
                    }
                    variant="link"
                    size="sm"
                  >
                    {t("shell.studio.newVariant")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
