import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { resolveStitchRuntimeMode } from "@/lib/media/stitch-runtime";
import { claimStitchTask } from "@/lib/services/stitch-service";

/**
 * 外部 stitch runner（GH Action，回滚路径）认领一个就绪任务。
 *
 * 调用方：.github/workflows/stitch-videos.yml → scripts/stitch-runner.ts
 *
 * 鉴权：`Authorization: Bearer ${CRON_SECRET}`（与 cron 复用同一密钥，避免再发一套）
 *
 * 只接受 POST：认领会 CAS PENDING → STITCHING（有副作用），GET 一律 405 ——
 * 改造前 GET 也会真认领，预取 / 爬虫 / 健康检查一碰就把任务抢走卡在 STITCHING。
 *
 * STITCH_RUNTIME=inprocess（生产默认）时生产只有一个合成器（stitch-dispatch 函数），
 * 这里一律返回 { task: null }：误触发的 runner 直接退出，不会产出与应用内合成器
 * 不一致的成片。回滚 = 设 STITCH_RUNTIME=external，本路由恢复认领。
 *
 * 返回：
 *   { task: { finalVideoId, attemptToken, segmentUrls[], aspectRatio, targetDurationSec, ... } }
 *   或 { task: null }（没有可拼任务时 runner 直接退出）
 */
export async function POST(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
  if (resolveStitchRuntimeMode() === "inprocess") {
    return NextResponse.json({ task: null, runtime: "inprocess" });
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

export async function GET() {
  return NextResponse.json(
    { error: "method not allowed", allow: "POST" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
