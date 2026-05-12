import { requireWizardPage } from "@/lib/api-auth";
import { getServerTranslator } from "@/i18n/server";
import { WizardNewClient } from "./wizard-new-client";

export default async function WizardNewPage() {
  await requireWizardPage();
  const { t } = await getServerTranslator();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {t("wizard.step1.pageTitle")}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          {t("wizard.step1.pageSubtitle")}
        </p>
      </div>
      <WizardNewClient />
    </div>
  );
}
