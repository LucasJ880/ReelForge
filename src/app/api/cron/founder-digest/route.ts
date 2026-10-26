import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { runFounderDigest } from "@/lib/services/founder-digest-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 创始人每日汇总 cron 入口（2026-10-25 审计 B8；vercel.json 每天一次）。
 *
 * - 与其它 cron 同一套鉴权：Authorization: Bearer ${CRON_SECRET}（缺失 503、错误 401），先于任何查询；
 * - 只读：过去 24 小时的试点申请、询盘页新询盘、失败视频与各账号「需要处理」；
 * - 没配 RESEND_API_KEY / EMAIL_FROM：汇总只打日志，照样 200 `{ sent: false, reason: "not_configured" }`；
 * - 按 UTC 日幂等：当天已经发过（cron 重试 / 重复触发）返回 `{ sent: false, reason: "already_sent" }`。
 */
export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
  try {
    return NextResponse.json(await runFounderDigest());
  } catch (err) {
    console.error("[cron/founder-digest] failed:", (err as Error).message);
    return NextResponse.json({ sent: false, reason: "error" }, { status: 500 });
  }
}

export const POST = GET;
