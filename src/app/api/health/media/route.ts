import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { runMediaHealthProbe } from "@/lib/media/media-health";

/**
 * GET /api/health/media —— 媒体运行时健康探针（4.6）。
 *
 * 与 /api/health 不同：这里会真跑 ffmpeg 与 sharp（耗 CPU、暴露二进制路径），
 * 因此在 handler 内做 fail-closed 机器鉴权（CRON_SECRET 缺失 503、错误 401）。
 * middleware 对 /api/health/* 前缀放行，真正的守卫就是这里的 machineAuthFailure。
 *
 * 返回：ffmpeg 版本 + 字体 / BGM 打包情况 + 1 秒合成探针（中文尾卡 SVG 栅格化、
 * 中文字幕 ass 烧录、输出字节数）。全部通过 200，否则 503（便于监控告警）。
 * `?frame=1`：直接返回合成结果中间帧 JPEG，验收时人眼看字幕与尾卡文字。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface HealthMediaDependencies {
  machineAuthFailure: typeof machineAuthFailure;
  runMediaHealthProbe: typeof runMediaHealthProbe;
}

const defaultDependencies: HealthMediaDependencies = {
  machineAuthFailure,
  runMediaHealthProbe,
};

export function createHealthMediaHandler(
  overrides: Partial<HealthMediaDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function healthMediaHandler(req: NextRequest): Promise<Response> {
    const authFailure = dependencies.machineAuthFailure(req);
    if (authFailure) return authFailure;

    const wantsFrame = req.nextUrl.searchParams.get("frame") === "1";
    const { report, frameJpeg } = await dependencies.runMediaHealthProbe({
      withFrame: wantsFrame,
    });
    if (wantsFrame && frameJpeg) {
      return new NextResponse(new Uint8Array(frameJpeg), {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "no-store",
          "x-media-health-ok": report.ok ? "1" : "0",
        },
      });
    }
    return NextResponse.json(report, {
      status: report.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  };
}

const healthMedia = createHealthMediaHandler();

export async function GET(req: NextRequest) {
  return healthMedia(req);
}
