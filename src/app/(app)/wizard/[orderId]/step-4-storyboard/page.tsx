import { notFound } from "next/navigation";
import { getClientProject } from "@/lib/services/client-project-service";
import {
  getCurrentWizardStoryboard,
} from "@/lib/services/wizard-storyboard-service";
import { getCurrentWizardScript } from "@/lib/services/wizard-script-service";
import { isLLMAvailable } from "@/lib/providers/openai";
import { StoryboardStepClient } from "./storyboard-step-client";

export default async function WizardStep4Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
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
          Step 4 · 分镜 + 拍摄指导
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          每个镜头会附带商家可看懂的拍摄指南：要拍什么、镜头类型、是否需要真人。
          {!isLLMAvailable() && (
            <span className="ml-1 text-amber-300">
              当前未配置 OPENAI_API_KEY，将使用 mock storyboard。
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
