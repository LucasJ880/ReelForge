import { requireWizardPage } from "@/lib/api-auth";
import { WizardNewClient } from "./wizard-new-client";

export default async function WizardNewPage() {
  await requireWizardPage();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Client Wizard · Step 1 / 6 · 项目目标
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          告诉我们这个项目是给谁拍的、要达到什么目标。所有字段都会进入 Wizard 后续步骤的 AI 输入。
        </p>
      </div>
      <WizardNewClient />
    </div>
  );
}
