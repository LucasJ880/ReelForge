import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import { pollRunningJobs } from "@/lib/services/video-service";
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
 * 整轮超过 CRON_OVERRUN_ALERT_MS 发运维告警——清扫与退款都挂在这条 cron 的尾部，
 * 被平台在 300 秒掐掉就是整轮丢失。
 *
 * 2026-11-16：成片画面质检整套删除，这里不再跑交付后补检与成片级复检（两者在开关关着时本来就是空转）。
 * 同日收尾：产品图任务与图文帖配图的轮询也删了（两个页面已删，生产库里没有在途任务），这里只剩出片、故事板、清扫。
 */
export const maxDuration = 300;
/** 单轮耗时告警线：离 maxDuration 还有 60 秒余量 */
export const CRON_OVERRUN_ALERT_MS = 240_000;

interface PollVideosDependencies {
  machineAuthFailure: typeof machineAuthFailure;
  startSchedulerHeartbeat: typeof startSchedulerHeartbeat;
  pollRunningJobs: typeof pollRunningJobs;
  pollPendingStoryboardRuns: typeof pollPendingStoryboardRuns;
  sweepStuckTasks: typeof sweepStuckTasks;
  sendOpsAlert: typeof sendOpsAlert;
  nowMs: () => number;
}

const defaultDependencies: PollVideosDependencies = {
  machineAuthFailure,
  startSchedulerHeartbeat,
  pollRunningJobs,
  pollPendingStoryboardRuns,
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
    const [videoResult, storyboardResult] = await Promise.allSettled([
      dependencies.pollRunningJobs(30),
      dependencies.pollPendingStoryboardRuns(20),
    ] as const);
    const [sweepResult] = await Promise.allSettled([dependencies.sweepStuckTasks()]);

    const storyboardFailed = storyboardResult.status === "rejected";
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
        storyboardPolled: storyboardResult.status === "fulfilled" ? storyboardResult.value : 0,
        sweepCompleted: !sweepFailed,
      });
      return NextResponse.json(
        {
          error: message,
            storyboardError: storyboardFailed ? errorMessage(storyboardResult) : null,
          sweep: sweepResult.status === "fulfilled" ? sweepResult.value : null,
          heartbeat: heartbeatEvent,
        },
        { status: 500 },
      );
    }

    const degraded = storyboardFailed || sweepFailed;
    const heartbeatEvent = heartbeat.finish(degraded ? "degraded" : "ok", {
      polled: videoResult.value.polled,
      storyboardPolled: storyboardResult.status === "fulfilled" ? storyboardResult.value : 0,
      sweepCompleted: !sweepFailed,
    });
    return NextResponse.json({
      ...videoResult.value,
      storyboardError: storyboardFailed ? errorMessage(storyboardResult) : null,
      sweep: sweepResult.status === "fulfilled" ? sweepResult.value : null,
      elapsedMs,
      degraded,
      heartbeat: heartbeatEvent,
    });
  }
  return pollVideosHandler;
}

const pollVideos = createPollVideosHandler();
export async function GET(req: NextRequest) {
  return pollVideos(req);
}

export const POST = GET;
