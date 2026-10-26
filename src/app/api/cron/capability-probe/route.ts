import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import {
  probeShuyuCapabilities,
  runCapabilityProbeCycle,
} from "@/lib/services/capability-probe-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/// 各项探测并行、单项 15 秒超时；留足余量给慢的那一项。
export const maxDuration = 60;

/**
 * C1 · 定时能力探测（PRD §6 / M7）+ C4 · 全能力状态。
 *
 * 与 /api/internal/video-provider-routes 的存活发现互补：
 * 那条回答「现在能不能提交」，这条回答「契约漂了没有、漂在哪个字段」。
 * C4 起同一轮把其余能力（OpenAI 写作 / 看图 / 配音 / 审核、图库、抓取、抠图、邮件）也探一遍，
 * 结论落到 CapabilityStatus，客户界面据此诚实地显示「哪些暂停、改用什么」。
 *
 * `?force=1`：连 24 小时节流的 TTS 探测也立刻跑（运维补完额度 / 权限后用）。
 */
export async function GET(req: NextRequest) {
  const machineFailure = machineAuthFailure(req);
  if (machineFailure) return machineFailure;

  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await probeShuyuCapabilities();
  /// 能力状态探测自己吞掉单项错误；整轮失败也只记日志，不影响 Shuyu 漂移告警的返回码。
  const capabilities = await runCapabilityProbeCycle({ shuyu: result, force }).catch((error: unknown) => {
    console.error("[capability-probe] 能力状态探测失败：", (error as Error).message);
    return null;
  });
  return NextResponse.json({ ...result, capabilities }, {
    /// 漂移时返回 503：让外部拨测（uptime 监控）也能直接告警。
    status: result.ok ? 200 : 503,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
