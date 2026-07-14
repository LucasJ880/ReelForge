import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { processPendingFinalVideos } from "@/lib/services/stitch-service";

/**
 * 遗留 cron 路由 —— Vercel Cron 用过的「在函数里 spawn ffmpeg」入口。
 *
 * 现状（2026-05 重构后）：
 *   - 真正的 ffmpeg 拼接已搬到 GitHub Action runner（见 .github/workflows/stitch-videos.yml）。
 *   - 本路由保留向后兼容：旧 Vercel Cron / 误配置的 GH Action 仍可能打到这里。
 *   - 默认行为：直接返回 `{ skipped: true, reason: "delegated to external runner" }`，
 *     不会 spawn ffmpeg（在 Vercel 里必失败）。
 *
 * 何时仍会真实拼接？
 *   - 仅当 STITCH_RUNTIME=local（本地 dev / `next dev` + 手动 curl）时，
 *     processPendingFinalVideos 会真正调 stitchFinalVideo 走本地 ffmpeg。
 *
 * 不要删除路由本身：避免 GH Secrets / Vercel Cron 配置还指着它的版本失败。
 */
export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;

  const runtime = (process.env.STITCH_RUNTIME ?? "").trim().toLowerCase();
  if (runtime !== "local") {
    return NextResponse.json({
      skipped: true,
      reason: "delegated to external runner",
      hint: "GitHub Action workflow 'stitch-videos' will pick up pending FinalVideos every 5 min",
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
