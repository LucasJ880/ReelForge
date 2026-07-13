import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { BusinessMetricsForm } from "@/components/business/business-metrics-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <BusinessPageHeader
        kicker={t("shell.integrations.kicker")}
        title={t("shell.integrations.title")}
        subtitle={t("shell.integrations.subtitle")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("shell.integrations.metricsTitle")}</CardTitle>
          <CardDescription>
            {t("shell.integrations.metricsSubtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessMetricsForm videos={videos} />
        </CardContent>
      </Card>

      <ul className="grid gap-4 lg:grid-cols-3">
        {platforms.map((p) => (
          <li key={p.id}>
            <Card className="h-full" size="sm">
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant={p.status === "manual" ? "default" : "secondary"}>
                {p.status === "manual"
                  ? t("shell.integrations.statusSelfServe")
                  : t("shell.badgeSoon")}
                </Badge>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Card size="sm">
        <CardContent className="pt-2 text-body text-muted-foreground">
          {t("shell.integrations.footer")}{" "}
          <Button
            render={<Link href="/business/performance" />}
            variant="link"
            className="h-auto px-1"
          >
            {t("shell.businessNav.performance")}
          </Button>
          {" · "}
          <Button
            render={<Link href="/business/recommendations" />}
            variant="link"
            className="h-auto px-1"
          >
            {t("shell.businessNav.recommendations")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
