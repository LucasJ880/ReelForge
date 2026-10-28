/**
 * 故事板分镜出图走 Runway（GPT Image 2，与 Shuyu 出图同一个模型；2026-10-28 晚，灰度名单先用）。
 *
 * 分镜行没有「供应商」列：提交前把 planId 记成 RUNWAY_STORYBOARD_PLAN_ID，之后的轮询、取图、重做与确认未知的恢复
 * 都按它分流（storyboard-service.ts）。不改库表。
 */
import { db } from "@/lib/db";
import {
  createRunwayTask,
  fetchRunwayOutputImage,
  getRunwayTask,
  RUNWAY_IMAGE_REFERENCES_MAX,
  runwayImageRatio,
} from "@/lib/providers/runway";
import { ProviderSubmissionError } from "./providers/submission-error";
import { runwaySubmissionError } from "./providers/runway-video-provider";
import { usesRunwayStoryboardImages } from "./runway-rollout";

export const RUNWAY_STORYBOARD_PLAN_ID = "runway:gpt_image_2";
export const RUNWAY_STORYBOARD_IMAGE_MODEL = "gpt_image_2";

export interface RunwayStoryboardImageResult {
  status: "queued" | "processing" | "succeeded" | "failed";
  rawStatus: string;
  outputUrls: string[];
  /// FAILED 时 Runway 给的原因（含 failureCode）
  failure?: string;
}

export async function submitRunwayStoryboardImage(input: {
  prompt: string;
  aspectRatio: string;
  inputImages: readonly string[];
}): Promise<{ externalTaskId: string; estimatedCredits: number | null }> {
  const ratio = runwayImageRatio(input.aspectRatio);
  if (!ratio) {
    throw new ProviderSubmissionError(`Runway 出图不支持画幅 ${input.aspectRatio}`, {
      providerId: "runway",
      stage: "preflight",
      retryable: false,
    });
  }
  const references = [...new Set(input.inputImages.map((url) => url.trim()).filter(Boolean))].slice(0, RUNWAY_IMAGE_REFERENCES_MAX);
  try {
    const task = await createRunwayTask({
      endpoint: "/v1/text_to_image",
      body: {
        model: RUNWAY_STORYBOARD_IMAGE_MODEL,
        promptText: input.prompt,
        ratio,
        ...(references.length > 0 ? { referenceImages: references.map((uri) => ({ uri })) } : {}),
        quality: "high",
        outputCount: 1,
      },
    });
    return { externalTaskId: task.id, estimatedCredits: task.estimatedCredits };
  } catch (error) {
    throw runwaySubmissionError(error);
  }
}

export async function pollRunwayStoryboardImage(taskId: string): Promise<RunwayStoryboardImageResult> {
  const task = await getRunwayTask(taskId);
  switch (task.status) {
    case "PENDING":
    case "THROTTLED":
      return { status: "queued", rawStatus: task.status, outputUrls: [] };
    case "RUNNING":
      return { status: "processing", rawStatus: task.status, outputUrls: [] };
    case "SUCCEEDED":
      return { status: "succeeded", rawStatus: task.status, outputUrls: task.output ?? [] };
    default:
      return {
        status: "failed",
        rawStatus: task.status,
        outputUrls: [],
        failure: task.status === "CANCELLED"
          ? "任务已取消"
          : `${task.failure ?? "出图失败"}${task.failureCode ? `（${task.failureCode}）` : ""}`,
      };
  }
}

export const fetchRunwayStoryboardImage = (url: string) => fetchRunwayOutputImage(url);

/** 这一轮的发起人该不该用 Runway 出图（灰度名单 / 全员开关 + 配了 key）。查不到人就留在 Shuyu。 */
export async function runwayStoryboardImagesForUser(userId: string): Promise<boolean> {
  const user = await db.adminUser.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null);
  return usesRunwayStoryboardImages({ userId, email: user?.email ?? null });
}
