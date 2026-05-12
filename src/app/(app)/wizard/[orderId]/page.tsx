import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerTranslator } from "@/i18n/server";
import { getClientProject } from "@/lib/services/client-project-service";
import { BrandAssetsCard } from "./brand-assets-card";

export default async function WizardOverviewPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { t } = await getServerTranslator();
  const project = await getClientProject(orderId);
  if (!project || !project.brief) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("wizard.overview.briefIncomplete")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>{t("wizard.overview.briefIncompleteDesc")}</p>
          <Link href="/wizard">
            <Button variant="outline">
              {t("wizard.overview.backToWizardHome")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { brief } = project;
  const platformsLabel = brief.targetPlatforms
    .map((p) => t(`platform.${p}`))
    .join(", ");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("wizard.overview.goalsLocked")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <KV k={t("wizard.overview.businessLabel")} v={brief.businessName} />
          <KV
            k={t("wizard.overview.industryLabel")}
            v={t(`industry.${brief.industry}`)}
          />
          <KV
            k={t("wizard.overview.objectiveLabel")}
            v={t(`objective.${brief.objective}`)}
          />
          <KV k={t("wizard.overview.platformsLabel")} v={platformsLabel} />
          <KV
            k={t("wizard.overview.durationLabel")}
            v={`${brief.videoLengthSec}s`}
          />
          <KV
            k={t("wizard.overview.toneLabel")}
            v={t(`brandTone.${brief.brandTone}`)}
          />
          {brief.keyMessage && (
            <KV
              k={t("wizard.overview.keyMessageLabel")}
              v={brief.keyMessage}
            />
          )}
          {brief.brandAssets.ctaText && (
            <KV
              k={t("wizard.overview.ctaLabel")}
              v={brief.brandAssets.ctaText}
            />
          )}
        </CardContent>
      </Card>

      <BrandAssetsCard
        projectId={orderId}
        businessName={brief.businessName}
        industry={brief.industry}
        currentLogoUrl={brief.brandAssets.logoUrl ?? null}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("wizard.overview.nextStep")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("wizard.overview.continueDescription")}
          </p>
          <Link href={`/wizard/${orderId}/step-2-card`}>
            <Button>
              {t("wizard.overview.continueToCreative")}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground text-right">{v}</span>
    </div>
  );
}
