import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import {
  CRON_FRAME_QA_BUDGET,
  frameQaBudgetUsage,
  runWithFrameQaBudget,
} from "@/lib/services/frame-qa-gate";
import { pollRunningJobs } from "@/lib/services/video-service";
import { pollPendingProductImageJobs } from "@/lib/services/product-image-service";
import { pollPendingContentPostRenders } from "@/lib/services/content-post-image-job-service";
import { sweepProductAnchorCutouts } from "@/lib/services/product-anchor-service";
import { sweepStuckTasks } from "@/lib/services/sweep-service";
import { pollPendingStoryboardRuns } from "@/lib/video-generation/storyboard-service";
import {
  FINAL_FRAME_QA_BATCH,
  runPendingFinalFrameQa,
} from "@/lib/services/final-frame-qa-service";

/**
 * Vercel Cron 调用：每 1-5 分钟扫描一次正在运行的 VideoJob，
 * 查询 Seedance 状态并更新。
 *
 * 顺带执行孤儿/超时清扫（sweep-service）：超时任务转为用户可见的失败状态，
 * 保证「任何任务都不会永远处于进行中」。清扫失败不影响 poll 主流程。
 *
 * D2：整次调用跑在帧质检预算上下文里（条数 + 时长上限）。用户面轮询遇到
 * 「供应商已完成」只 defer，由这里（或 process-batches）真正跑质检并收尾。
 *
 * C2：图文帖的 Shuyu 配图也在这里推进（商家关了页面，在途的图照样收回、这一轮照样收尾）。
 *
 * P02-E0：产品锚点的待抠图续跑也挂在这里（每轮最多 5 个、总预算 20s），
 * 由 PRODUCT_ANCHOR_CUTOUT_CRON=on 打开，默认关；抠图能力不可用时直接跳过。
 *
 * P01-E（影子）：成片级复检在同一份帧质检预算里跟在轮询 / 清扫之后跑，每次最多 2 条，
 * 由 FINAL_FRAME_QA_MODE=shadow 打开，默认 off；结论只记进 QAReview，不拦任何东西。
 */
export const maxDuration = 300;

interface PollVideosDependencies {
  machineAuthFailure: typeof machineAuthFailure;
  startSchedulerHeartbeat: typeof startSchedulerHeartbeat;
  pollRunningJobs: typeof pollRunningJobs;
  pollPendingProductImageJobs: typeof pollPendingProductImageJobs;
  pollPendingStoryboardRuns: typeof pollPendingStoryboardRuns;
  pollPendingContentPostRenders: typeof pollPendingContentPostRenders;
  sweepStuckTasks: typeof sweepStuckTasks;
  sweepProductAnchorCutouts: typeof sweepProductAnchorCutouts;
  runPendingFinalFrameQa: typeof runPendingFinalFrameQa;
}

const defaultDependencies: PollVideosDependencies = {
  machineAuthFailure,
  startSchedulerHeartbeat,
  pollRunningJobs,
  pollPendingProductImageJobs,
  pollPendingStoryboardRuns,
  pollPendingContentPostRenders,
  sweepStuckTasks,
  sweepProductAnchorCutouts,
  runPendingFinalFrameQa,
};

function errorMessage(result: PromiseRejectedResult): string {
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

export function createPollVideosHandler(
  overrides: Partial<PollVideosDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  async function pollVideosHandler(req: NextRequest) {
    const authFailure = dependencies.machineAuthFailure(req);
    if (authFailure) return authFailure;
    const heartbeat = dependencies.startSchedulerHeartbeat("poll-videos");
    const [videoResult, imageResult, storyboardResult, contentPostResult, anchorResult] = await Promise.allSettled([
      dependencies.pollRunningJobs(30),
      dependencies.pollPendingProductImageJobs(20),
      dependencies.pollPendingStoryboardRuns(20),
      dependencies.pollPendingContentPostRenders(20),
      dependencies.sweepProductAnchorCutouts(),
    ] as const);
    const [sweepResult] = await Promise.allSettled([dependencies.sweepStuckTasks()]);
    /// 成片级复检排在最后：段级门禁先用预算，复检吃剩下的（都在同一个 runWithFrameQaBudget 里）
    const [finalFrameQaResult] = await Promise.allSettled([
      dependencies.runPendingFinalFrameQa(FINAL_FRAME_QA_BATCH),
    ]);

    const imageFailed = imageResult.status === "rejected";
    const storyboardFailed = storyboardResult.status === "rejected";
    const contentPostFailed = contentPostResult.status === "rejected";
    const anchorFailed = anchorResult.status === "rejected";
    const sweepFailed = sweepResult.status === "rejected";
    const finalFrameQaFailed = finalFrameQaResult.status === "rejected";
    if (imageFailed) {
      console.warn("[cron/poll-videos] image poll failed:", errorMessage(imageResult));
    }
    if (storyboardFailed) {
      console.warn("[cron/poll-videos] storyboard poll failed:", errorMessage(storyboardResult));
    }
    if (contentPostFailed) {
      console.warn("[cron/poll-videos] content-post image poll failed:", errorMessage(contentPostResult));
    }
    if (anchorFailed) {
      console.warn("[cron/poll-videos] product anchor cutout sweep failed:", errorMessage(anchorResult));
    }
    if (sweepFailed) {
      console.warn("[cron/poll-videos] sweep failed:", errorMessage(sweepResult));
    }
    if (finalFrameQaFailed) {
      console.warn("[cron/poll-videos] final-frame qa failed:", errorMessage(finalFrameQaResult));
    }

    if (videoResult.status === "rejected") {
      const message = errorMessage(videoResult);
      const heartbeatEvent = heartbeat.finish("error", {
        polled: 0,
        imagePolled: imageResult.status === "fulfilled" ? imageResult.value.polled : 0,
        storyboardPolled: storyboardResult.status === "fulfilled" ? storyboardResult.value : 0,
        contentPostPolled: contentPostResult.status === "fulfilled" ? contentPostResult.value : 0,
        sweepCompleted: !sweepFailed,
      });
      return NextResponse.json(
        {
          error: message,
          imagePolled: imageResult.status === "fulfilled" ? imageResult.value.polled : 0,
          imageError: imageFailed ? errorMessage(imageResult) : null,
          storyboardError: storyboardFailed ? errorMessage(storyboardResult) : null,
          contentPostError: contentPostFailed ? errorMessage(contentPostResult) : null,
          anchorCutout: anchorResult.status === "fulfilled" ? anchorResult.value : null,
          anchorCutoutError: anchorFailed ? errorMessage(anchorResult) : null,
          sweep: sweepResult.status === "fulfilled" ? sweepResult.value : null,
          finalFrameQa: finalFrameQaResult.status === "fulfilled" ? finalFrameQaResult.value : null,
          finalFrameQaError: finalFrameQaFailed ? errorMessage(finalFrameQaResult) : null,
          heartbeat: heartbeatEvent,
        },
        { status: 500 },
      );
    }

    const degraded =
      imageFailed || storyboardFailed || contentPostFailed || anchorFailed || sweepFailed || finalFrameQaFailed;
    const heartbeatEvent = heartbeat.finish(degraded ? "degraded" : "ok", {
      polled: videoResult.value.polled,
      imagePolled: imageResult.status === "fulfilled" ? imageResult.value.polled : 0,
      storyboardPolled: storyboardResult.status === "fulfilled" ? storyboardResult.value : 0,
      contentPostPolled: contentPostResult.status === "fulfilled" ? contentPostResult.value : 0,
      sweepCompleted: !sweepFailed,
    });
    return NextResponse.json({
      ...videoResult.value,
      imagePolled: imageResult.status === "fulfilled" ? imageResult.value.polled : 0,
      imageRecovered: imageResult.status === "fulfilled" ? imageResult.value.recovered : 0,
      imageError: imageFailed ? errorMessage(imageResult) : null,
      storyboardError: storyboardFailed ? errorMessage(storyboardResult) : null,
      contentPostPolled: contentPostResult.status === "fulfilled" ? contentPostResult.value : 0,
      contentPostError: contentPostFailed ? errorMessage(contentPostResult) : null,
      anchorCutout: anchorResult.status === "fulfilled" ? anchorResult.value : null,
      anchorCutoutError: anchorFailed ? errorMessage(anchorResult) : null,
      sweep: sweepResult.status === "fulfilled" ? sweepResult.value : null,
      finalFrameQa: finalFrameQaResult.status === "fulfilled" ? finalFrameQaResult.value : null,
      finalFrameQaError: finalFrameQaFailed ? errorMessage(finalFrameQaResult) : null,
      degraded,
      frameQa: frameQaBudgetUsage(),
      heartbeat: heartbeatEvent,
    });
  }
  return (req: NextRequest) =>
    runWithFrameQaBudget(
      { label: "cron:poll-videos", ...CRON_FRAME_QA_BUDGET },
      () => pollVideosHandler(req),
    );
}

const pollVideos = createPollVideosHandler();
export async function GET(req: NextRequest) {
  return pollVideos(req);
}

export const POST = GET;
