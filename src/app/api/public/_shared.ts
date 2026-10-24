import { NextResponse, type NextRequest } from "next/server";
import { customerApiError } from "@/lib/contracts/customer-api";

/**
 * 两个公开提交端点（/api/public/leads、/api/public/pilot-applications）的共用件。
 * middleware 只放行这两个精确路径；鉴权之外的守卫全部在 handler 里：
 * 体积上限、蜜罐、按访客哈希限流、zod 校验。
 */

export const PUBLIC_BODY_MAX_BYTES = 8 * 1024;

/// 蜜罐字段名：表单里藏在屏幕外、对读屏隐藏；真人不会填，脚本会。
export const HONEYPOT_FIELD = "faxNumber";

export type PublicReason =
  | "contact_required"
  | "consent_required"
  | "phone_invalid"
  | "invalid"
  | "rate_limited"
  | "not_found"
  | "unavailable";

export async function readLimitedJson(req: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > PUBLIC_BODY_MAX_BYTES) return { ok: false };
  try {
    const text = await req.text();
    if (text.length > PUBLIC_BODY_MAX_BYTES) return { ok: false };
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function honeypotTripped(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const value = (body as Record<string, unknown>)[HONEYPOT_FIELD];
  return typeof value === "string" && value.trim().length > 0;
}

/** 失败响应：契约错误体 + reason（客户端按 reason 取本地化人话）+ 可选备用联系方式。 */
export function publicFailure(
  reason: PublicReason,
  extra: { fallbackPhone?: string | null; fallbackEmail?: string | null } = {},
) {
  const fallback = {
    ...(extra.fallbackPhone ? { fallbackPhone: extra.fallbackPhone } : {}),
    ...(extra.fallbackEmail ? { fallbackEmail: extra.fallbackEmail } : {}),
  };
  if (reason === "rate_limited") {
    return NextResponse.json(
      {
        ...customerApiError({ code: "RATE_LIMITED", message: "提交太频繁了，请稍后再试", retryable: true, action: "retry" }),
        reason,
        ...fallback,
      },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }
  if (reason === "not_found") {
    return NextResponse.json(
      {
        ...customerApiError({ code: "RESOURCE_NOT_FOUND", message: "页面不存在或未开通", retryable: false, action: "contact_support" }),
        reason,
      },
      { status: 404 },
    );
  }
  if (reason === "unavailable") {
    return NextResponse.json(
      {
        ...customerApiError({ code: "SERVICE_UNAVAILABLE", message: "暂时没提交成功，请稍后再试", retryable: true, action: "retry" }),
        reason,
        ...fallback,
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      ...customerApiError({ code: "VALIDATION_FAILED", message: "提交内容不完整或格式不对", retryable: false, action: "fix_request" }),
      reason,
    },
    { status: 400 },
  );
}

/** 蜜罐命中也回成功：不给脚本任何「被识破」的信号，也不落库。 */
export function publicSuccess() {
  return NextResponse.json({ ok: true }, { status: 201 });
}
