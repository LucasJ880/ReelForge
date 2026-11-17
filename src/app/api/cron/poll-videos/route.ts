import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import { CRON_VISION_BUDGET, runWithVisionBudget } from "@/lib/services/vision-budget-context";
import { pollRunningJobs } from "@/lib/services/video-service";
import { pollPendingProductImageJobs } from "@/lib/services/product-image-service";
import { pollPendingContentPostRenders } from "@/lib/services/content-post-image-job-service";
import { sweepStuckTasks } from "@/lib/services/sweep-service";
import { pollPendingStoryboardRuns } from "@/lib/video-generation/storyboard-service";
import { sendOpsAlert } from "@/lib/services/ops-alert-service";

/**
 * Vercel Cron 调用：每 1-5 分钟扫描一次正在运行的 VideoJob，
 * 查询 Seedance 状态并更新。
 *
 * 顺带执行孤儿/超时清扫（sweep-service）：超时任务转为用户可见的失败状态，
 * 保证「任何任务都不会永远处于进行中」。清扫失败不影响 poll 主流程。
 *
 * 整次调用跑在看图预算上下文里（vision-budget-context）：故事板 AI 审帧只在 cron 里预约得到时长。
 *
 * C2：图文帖的 Shuyu 配图也在这里推进（商家关了页面，在途的图照样收回、这一轮照样收尾）。
 *
 * 整轮超过 CRON_OVERRUN_ALERT_MS 发运维告警——清扫与退款都挂在这条 cron 的尾部，
 * 被平台在 300 秒掐掉就是整轮丢失。
 *
 * 2026-11-16：成片画面质检整套删除，这里不再跑交付后补检与成片级复检（两者在开关关着时本来就是空转）。
 */
export const maxDuration = 300;
/** 单轮耗时告警线：离 maxDuration 还有 60 秒余量 */
export const CRON_OVERRUN_ALERT_MS = 240_000;

interface PollVideosDependencies {
  machineAuthFailure: typeof machineAuthFailure;
  startSchedulerHeartbeat: typeof startSchedulerHeartbeat;
  pollRunningJobs: typeof pollRunningJobs;
  pollPendingProductImageJobs: typeof pollPendingProductImageJobs;
  pollPendingStoryboardRuns: typeof pollPendingStoryboardRuns;
  pollPendingContentPostRenders: typeof pollPendingContentPostRenders;
  sweepStuckTasks: typeof sweepStuckTasks;
  sendOpsAlert: typeof sendOpsAlert;
  nowMs: () => number;
}

const defaultDependencies: PollVideosDependencies = {
  machineAuthFailure,
  startSchedulerHeartbeat,
  pollRunningJobs,
  pollPendingProductImageJobs,
  pollPendingStoryboardRuns,
  pollPendingContentPostRenders,
  sweepStuckTasks,
  sendOpsAlert,
  nowMs: () => Date.now(),
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
    const startedAtMs = dependencies.nowMs();
    const [videoResult, imageResult, storyboardResult, contentPostResult] = await Promise.allSettled([
      dependencies.pollRunningJobs(30),
      dependencies.pollPendingProductImageJobs(20),
      dependencies.pollPendingStoryboardRuns(20),
      dependencies.pollPendingContentPostRenders(20),
    ] as const);
    const [sweepResult] = await Promise.allSettled([dependencies.sweepStuckTasks()]);

    const imageFailed = imageResult.status === "rejected";
    const storyboardFailed = storyboardResult.status === "rejected";
    const contentPostFailed = contentPostResult.status === "rejected";
    const sweepFailed = sweepResult.status === "rejected";
    const elapsedMs = dependencies.nowMs() - startedAtMs;
    if (elapsedMs >= CRON_OVERRUN_ALERT_MS) {
      await dependencies.sendOpsAlert({
        kind: "cron_overrun",
        dedupeKey: "cron-overrun:poll-videos",
        title: "poll-videos 单轮接近 300 秒上限",
        lines: [
          `本轮耗时 ${Math.round(elapsedMs / 1000)} 秒`,
          "清扫、退款都在这条 cron 的尾部；被平台掐掉就是整轮丢失",
        ],
      });
    }
    if (imageFailed) {
      console.warn("[cron/poll-videos] image poll failed:", errorMessage(imageResult));
    }
    if (storyboardFailed) {
      console.warn("[cron/poll-videos] storyboard poll failed:", errorMessage(storyboardResult));
    }
    if (contentPostFailed) {
      console.warn("[cron/poll-videos] content-post image poll failed:", errorMessage(contentPostResult));
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
          sweep: sweepResult.status === "fulfilled" ? sweepResult.value : null,
          heartbeat: heartbeatEvent,
        },
        { status: 500 },
      );
    }

    const degraded = imageFailed || storyboardFailed || contentPostFailed || sweepFailed;
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
      sweep: sweepResult.status === "fulfilled" ? sweepResult.value : null,
      elapsedMs,
      degraded,
      heartbeat: heartbeatEvent,
    });
  }
  return (req: NextRequest) =>
    runWithVisionBudget(
      { label: "cron:poll-videos", ...CRON_VISION_BUDGET },
      () => pollVideosHandler(req),
    );
}

const pollVideos = createPollVideosHandler();
export async function GET(req: NextRequest) {
  return pollVideos(req);
}

export const POST = GET;
