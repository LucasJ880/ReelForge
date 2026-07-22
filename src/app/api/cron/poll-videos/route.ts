import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import { pollRunningJobs } from "@/lib/services/video-service";
import { pollPendingProductImageJobs } from "@/lib/services/product-image-service";
import { sweepStuckTasks } from "@/lib/services/sweep-service";
import { pollPendingStoryboardRuns } from "@/lib/video-generation/storyboard-service";

/**
 * Vercel Cron 调用：每 1-5 分钟扫描一次正在运行的 VideoJob，
 * 查询 Seedance 状态并更新。
 *
 * 顺带执行孤儿/超时清扫（sweep-service）：超时任务转为用户可见的失败状态，
 * 保证「任何任务都不会永远处于进行中」。清扫失败不影响 poll 主流程。
 */
interface PollVideosDependencies {
  machineAuthFailure: typeof machineAuthFailure;
  startSchedulerHeartbeat: typeof startSchedulerHeartbeat;
  pollRunningJobs: typeof pollRunningJobs;
  pollPendingProductImageJobs: typeof pollPendingProductImageJobs;
  pollPendingStoryboardRuns: typeof pollPendingStoryboardRuns;
  sweepStuckTasks: typeof sweepStuckTasks;
}

const defaultDependencies: PollVideosDependencies = {
  machineAuthFailure,
  startSchedulerHeartbeat,
  pollRunningJobs,
  pollPendingProductImageJobs,
  pollPendingStoryboardRuns,
  sweepStuckTasks,
};

function errorMessage(result: PromiseRejectedResult): string {
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

export function createPollVideosHandler(
  overrides: Partial<PollVideosDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function pollVideosHandler(req: NextRequest) {
    const authFailure = dependencies.machineAuthFailure(req);
    if (authFailure) return authFailure;
    const heartbeat = dependencies.startSchedulerHeartbeat("poll-videos");
    const [videoResult, imageResult, storyboardResult] = await Promise.allSettled([
      dependencies.pollRunningJobs(30),
      dependencies.pollPendingProductImageJobs(20),
      dependencies.pollPendingStoryboardRuns(20),
    ] as const);
    const [sweepResult] = await Promise.allSettled([dependencies.sweepStuckTasks()]);

    const imageFailed = imageResult.status === "rejected";
    const storyboardFailed = storyboardResult.status === "rejected";
    const sweepFailed = sweepResult.status === "rejected";
    if (imageFailed) {
      console.warn("[cron/poll-videos] image poll failed:", errorMessage(imageResult));
    }
    if (storyboardFailed) {
      console.warn("[cron/poll-videos] storyboard poll failed:", errorMessage(storyboardResult));
    }
    if (sweepFailed) {
      console.warn("[cron/poll-videos] sweep failed:", errorMessage(sweepResult));
    }

    if (videoResult.status === "rejected") {
      const message = errorMessage(videoResult);
      const heartbeatEvent = heartbeat.finish("error", {
        polled: 0,
        imagePolled: imageResult.status === "fulfilled" ? imageResult.value.polled : 0,
        storyboardPolled: storyboardResult.status === "fulfilled" ? storyboardResult.value : 0,
        sweepCompleted: !sweepFailed,
      });
      return NextResponse.json(
        {
          error: message,
          imagePolled: imageResult.status === "fulfilled" ? imageResult.value.polled : 0,
          imageError: imageFailed ? errorMessage(imageResult) : null,
          storyboardError: storyboardFailed ? errorMessage(storyboardResult) : null,
          sweep: sweepResult.status === "fulfilled" ? sweepResult.value : null,
          heartbeat: heartbeatEvent,
        },
        { status: 500 },
      );
    }

    const degraded = imageFailed || storyboardFailed || sweepFailed;
    const heartbeatEvent = heartbeat.finish(degraded ? "degraded" : "ok", {
      polled: videoResult.value.polled,
      imagePolled: imageResult.status === "fulfilled" ? imageResult.value.polled : 0,
      storyboardPolled: storyboardResult.status === "fulfilled" ? storyboardResult.value : 0,
      sweepCompleted: !sweepFailed,
    });
    return NextResponse.json({
      ...videoResult.value,
      imagePolled: imageResult.status === "fulfilled" ? imageResult.value.polled : 0,
      imageRecovered: imageResult.status === "fulfilled" ? imageResult.value.recovered : 0,
      imageError: imageFailed ? errorMessage(imageResult) : null,
      storyboardError: storyboardFailed ? errorMessage(storyboardResult) : null,
      sweep: sweepResult.status === "fulfilled" ? sweepResult.value : null,
      degraded,
      heartbeat: heartbeatEvent,
    });
  };
}

const pollVideos = createPollVideosHandler();
export async function GET(req: NextRequest) {
  return pollVideos(req);
}

export const POST = GET;
