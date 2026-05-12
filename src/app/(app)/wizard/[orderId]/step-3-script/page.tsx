import { notFound } from "next/navigation";
import { getClientProject } from "@/lib/services/client-project-service";
import { getCurrentWizardScript } from "@/lib/services/wizard-script-service";
import { isLLMAvailable } from "@/lib/providers/openai";
import { getServerTranslator } from "@/i18n/server";
import { ScriptStepClient } from "./script-step-client";

export default async function WizardStep3Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { t } = await getServerTranslator();
  const project = await getClientProject(orderId);
  if (!project || !project.brief) notFound();

  const script = await getCurrentWizardScript(orderId);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("wizard.step3.pageTitle")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {t("wizard.step3.pageSubtitle")}
          {!isLLMAvailable() && (
            <span className="ml-1 text-amber-300">
              {t("wizard.step3.mockNotice")}
            </span>
          )}
        </p>
      </header>
      <ScriptStepClient
        orderId={orderId}
        initialScript={script}
        cardSelected={!!project.brief.selectedCardSlug}
      />
    </div>
  );
}
