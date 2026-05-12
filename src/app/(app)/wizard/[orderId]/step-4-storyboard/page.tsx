import { notFound } from "next/navigation";
import { getClientProject } from "@/lib/services/client-project-service";
import {
  getCurrentWizardStoryboard,
} from "@/lib/services/wizard-storyboard-service";
import { getCurrentWizardScript } from "@/lib/services/wizard-script-service";
import { isLLMAvailable } from "@/lib/providers/openai";
import { getServerTranslator } from "@/i18n/server";
import { StoryboardStepClient } from "./storyboard-step-client";

export default async function WizardStep4Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { t } = await getServerTranslator();
  const project = await getClientProject(orderId);
  if (!project || !project.brief) notFound();

  const [script, storyboard] = await Promise.all([
    getCurrentWizardScript(orderId),
    getCurrentWizardStoryboard(orderId),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("wizard.step4.pageTitle")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {t("wizard.step4.pageSubtitle")}
          {!isLLMAvailable() && (
            <span className="ml-1 text-amber-300">
              {t("wizard.step4.mockNotice")}
            </span>
          )}
        </p>
      </header>
      <StoryboardStepClient
        orderId={orderId}
        scriptReady={!!script}
        initialStoryboard={storyboard}
      />
    </div>
  );
}
