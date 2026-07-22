import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import { pollRunningJobs } from "@/lib/services/video-service";
import { pollPendingProductImageJobs } from "@/lib/services/product-image-service";
import { sweepStuckTasks } from "@/lib/services/sweep-service";

/**
 * Vercel Cron 调用：每 1-5 分钟扫描一次正在运行的 VideoJob，
 * 查询 Seedance 状态并更新。
 *
 * 顺带执行孤儿/超时清扫（sweep-service）：超时任务转为用户可见的失败状态，
 * 保证「任何任务都不会永远处于进行中」。清扫失败不影响 poll 主流程。
 */
export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
  const heartbeat = startSchedulerHeartbeat("poll-videos");
  try {
    const [result, imageResult] = await Promise.all([
      pollRunningJobs(30),
      pollPendingProductImageJobs(20),
    ]);
    let sweepFailed = false;
    const sweep = await sweepStuckTasks().catch((err) => {
      sweepFailed = true;
      console.warn("[cron/poll-videos] sweep failed:", (err as Error).message);
      return null;
    });
    const heartbeatEvent = heartbeat.finish(
      sweepFailed ? "degraded" : "ok",
      {
        polled: result.polled,
        imagePolled: imageResult.polled,
        sweepCompleted: !sweepFailed,
      },
    );
    return NextResponse.json({ ...result, imagePolled: imageResult.polled, sweep, heartbeat: heartbeatEvent });
  } catch (err) {
    const heartbeatEvent = heartbeat.finish("error", {
      polled: 0,
      sweepCompleted: false,
    });
    return NextResponse.json(
      { error: (err as Error).message, heartbeat: heartbeatEvent },
      { status: 500 },
    );
  }
}

export const POST = GET;
