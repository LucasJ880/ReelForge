import { NextRequest, NextResponse } from "next/server";
import { claimStitchTask } from "@/lib/services/stitch-service";

/**
 * 外部 stitch runner（GH Action）拉取一个就绪任务。
 *
 * 调用方：.github/workflows/stitch-videos.yml → scripts/stitch-runner.ts
 *
 * 鉴权：`Authorization: Bearer ${CRON_SECRET}`（与 cron 复用同一密钥，避免再发一套）
 *
 * 返回：
 *   { task: { finalVideoId, segmentUrls[], aspectRatio, targetDurationSec } }
 *   或 { task: null }（没有可拼任务时 runner 直接退出）
 *
 * 注意：claimStitchTask 会 CAS PENDING → STITCHING，因此同一任务不会被并发抢两次。
 */
export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const task = await claimStitchTask();
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json(
      { task: null, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const POST = GET;
