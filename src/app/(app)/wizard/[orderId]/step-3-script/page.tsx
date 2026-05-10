import { notFound } from "next/navigation";
import { getClientProject } from "@/lib/services/client-project-service";
import { getCurrentWizardScript } from "@/lib/services/wizard-script-service";
import { isLLMAvailable } from "@/lib/providers/openai";
import { ScriptStepClient } from "./script-step-client";

export default async function WizardStep3Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const project = await getClientProject(orderId);
  if (!project || !project.brief) notFound();

  const script = await getCurrentWizardScript(orderId);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          Step 3 · 生成 / 编辑脚本
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          脚本基于商家 brief + 选中的证据卡，由 AI 写一个原创版本。
          {!isLLMAvailable() && (
            <span className="ml-1 text-amber-300">
              当前未配置 OPENAI_API_KEY，将自动使用 mock 脚本，仍可继续后续流程。
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
