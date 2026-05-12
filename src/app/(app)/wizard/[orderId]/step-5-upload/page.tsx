import { notFound } from "next/navigation";
import { getClientProject } from "@/lib/services/client-project-service";
import {
  listWizardAssetsWithMissingReport,
} from "@/lib/services/wizard-asset-service";
import { getServerTranslator } from "@/i18n/server";
import { UploadStepClient } from "./upload-step-client";

export default async function WizardStep5Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { t } = await getServerTranslator();
  const project = await getClientProject(orderId);
  if (!project || !project.brief) notFound();

  const { assets, missingReport } = await listWizardAssetsWithMissingReport(
    orderId,
  );
  const shotChoices = missingReport.shots.map((s) => ({
    id: s.scenePlanId,
    label: `Shot ${s.sceneIndex} · ${s.visualIntent.slice(0, 40)}`,
    matched: s.matched,
    required: s.required,
  }));

  /// Server 端探测 Vercel Blob 是否就绪：传给 client 决定默认 tab，且不暴露 token
  const blobReady = !!process.env.BLOB_READ_WRITE_TOKEN;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("wizard.step5.pageTitle")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {t("wizard.step5.pageSubtitle")}
        </p>
      </header>
      <UploadStepClient
        orderId={orderId}
        initialAssets={assets}
        initialMissingReport={missingReport}
        shotChoices={shotChoices}
        blobReady={blobReady}
      />
    </div>
  );
}
