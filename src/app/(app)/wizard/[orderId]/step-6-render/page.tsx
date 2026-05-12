import { notFound } from "next/navigation";
import { getClientProject } from "@/lib/services/client-project-service";
import { db } from "@/lib/db";
import {
  isFfmpegAvailable,
} from "@/lib/services/wizard-render-service";
import { getServerTranslator } from "@/i18n/server";
import { RenderStepClient } from "./render-step-client";

export default async function WizardStep6Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { t } = await getServerTranslator();
  const project = await getClientProject(orderId);
  if (!project || !project.brief) notFound();

  const [recentJobs, ffmpegOk] = await Promise.all([
    db.wizardRenderJob.findMany({
      where: { deliveryOrderId: orderId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    isFfmpegAvailable(),
  ]);

  const realModeOn =
    process.env.ENABLE_WIZARD_FFMPEG_RENDER === "true" && ffmpegOk;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("wizard.step6.pageTitle")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {t("wizard.step6.pageSubtitle")}
        </p>
      </header>
      <RenderStepClient
        orderId={orderId}
        initialJobs={recentJobs}
        realModeOn={realModeOn}
        ffmpegOk={ffmpegOk}
      />
    </div>
  );
}
