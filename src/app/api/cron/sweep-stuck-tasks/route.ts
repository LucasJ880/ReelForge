import { NextRequest, NextResponse } from "next/server";
import { sweepStuckTasks } from "@/lib/services/sweep-service";

/**
 * 孤儿/超时任务清扫器 cron 入口。
 *
 * - 也会由 /api/cron/poll-videos 顺带触发（部署即生效，无需新增外部 cron 配置）；
 *   本路由保留为独立入口，便于手动触发与更密集的调度。
 * - 零计费：只做 DB 状态迁移，不调任何外部生成 API。
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (process.env.CRON_SECRET) {
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const result = await sweepStuckTasks();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const POST = GET;
