import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { pollRunningJobs } from "@/lib/services/video-service";
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
  try {
    const result = await pollRunningJobs(30);
    const sweep = await sweepStuckTasks().catch((err) => {
      console.warn("[cron/poll-videos] sweep failed:", (err as Error).message);
      return null;
    });
    return NextResponse.json({ ...result, sweep });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const POST = GET;
