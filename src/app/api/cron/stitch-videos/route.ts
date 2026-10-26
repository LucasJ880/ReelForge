import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { resolveStitchRuntimeMode } from "@/lib/media/stitch-runtime";
import { processPendingFinalVideos } from "@/lib/services/stitch-service";

/**
 * 遗留 cron 路由 —— 不在 vercel.json 里，只为旧配置 / 手动 curl 保留。
 *
 * 现状（C3，2026-10-25）：
 *   - 生产合成由 /api/cron/stitch-dispatch 完成（inprocess：专用函数里跑应用内合成器；
 *     external：派发 GitHub runner）。本路由默认只返回 skipped，不合成。
 *   - 仅当显式 STITCH_RUNTIME=local（本地 dev + 手动 curl）时，
 *     processPendingFinalVideos 会真正调 stitchFinalVideo 在本进程合成。
 *
 * 不要删除路由本身：避免 GH Secrets / Vercel Cron 配置还指着它的版本失败。
 */
export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;

  const explicit = (process.env.STITCH_RUNTIME ?? "").trim().toLowerCase();
  if (explicit !== "local") {
    const inprocess = resolveStitchRuntimeMode() === "inprocess";
    return NextResponse.json({
      skipped: true,
      reason: inprocess
        ? "composed in-process by /api/cron/stitch-dispatch"
        : "delegated to external runner",
      hint: inprocess
        ? "the stitch-dispatch cron claims ready FinalVideos every minute"
        : "GitHub Action workflow 'stitch-videos' is dispatched by /api/cron/stitch-dispatch",
    });
  }

  try {
    const result = await processPendingFinalVideos(5);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const POST = GET;
