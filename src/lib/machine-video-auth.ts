import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { customerApiError } from "@/lib/contracts/customer-api";

const MIN_TOKEN_LENGTH = 16;

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function unavailable(): NextResponse {
  return NextResponse.json(
    customerApiError({
      code: "SERVICE_UNAVAILABLE",
      message: "视频任务接口暂不可用。",
      retryable: false,
      action: "contact_support",
    }),
    { status: 503 },
  );
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    customerApiError({
      code: "AUTH_REQUIRED",
      message: "凭证无效。",
      retryable: false,
      action: "sign_in",
    }),
    { status: 401 },
  );
}

export type MachineVideoAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/**
 * 视频任务机器鉴权。只认 MACHINE_VIDEO_API_TOKEN，并固定绑定
 * MACHINE_VIDEO_API_USER_ID。CRON_SECRET 不能充当这个凭证；两者被配成
 * 同一个值时直接拒绝服务，避免定时任务密钥变成通用生成凭证。
 */
export function authenticateMachineVideoRequest(req: NextRequest): MachineVideoAuthResult {
  const token = process.env.MACHINE_VIDEO_API_TOKEN?.trim() ?? "";
  const userId = process.env.MACHINE_VIDEO_API_USER_ID?.trim() ?? "";
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (token.length < MIN_TOKEN_LENGTH || !userId || (cronSecret !== "" && token === cronSecret)) {
    return { ok: false, response: unavailable() };
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (!constantTimeEqual(authorization, `Bearer ${token}`)) {
    return { ok: false, response: unauthorized() };
  }
  return { ok: true, userId };
}
