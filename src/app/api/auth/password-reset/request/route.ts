import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LOCALES, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import type { PasswordResetRequestErrorCode } from "@/i18n/password-reset-copy";
import { requestPasswordReset } from "@/lib/services/password-reset-service";
import { RateLimitExceededError } from "@/lib/services/rate-limit-service";
import { clientIpFromHeaders } from "@/lib/services/tracked-link-service";
import { readLimitedJson, resetFailure } from "../_shared";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("请输入有效的邮箱"),
  /// 邮件里先写哪种语言；不传就看语言 cookie
  locale: z.enum(LOCALES).optional(),
});

const failure = resetFailure<PasswordResetRequestErrorCode>;

/**
 * POST /api/auth/password-reset/request —— 忘记密码：给注册邮箱发一封重置链接。
 *
 * Body: { email: string, locale?: "zh-CN" | "en-US" }
 *
 * 返回（邮箱注册过、没注册、已停用，响应完全一样，不泄露账号是否存在）：
 *   200 { ok: true, delivery: "email" }       —— 发信已开通；有账号的话邮件在响应之后发出
 *   200 { ok: true, delivery: "unavailable" } —— 全站还没开通发信，前端改为给联系邮箱
 *   400 { ok: false, code: "INVALID_EMAIL" | "INVALID_INPUT" }
 *   429 { ok: false, code: "RATE_LIMITED" }   —— 按访客网段 / 邮箱限流，与账号是否存在无关
 */
export async function POST(req: NextRequest) {
  const read = await readLimitedJson(req);
  if (!read.ok) return failure("INVALID_INPUT", "请求格式错误", 400);

  const parsed = requestSchema.safeParse(read.body);
  if (!parsed.success) {
    return parsed.error.issues[0]?.path[0] === "email"
      ? failure("INVALID_EMAIL", "请输入有效的邮箱", 400)
      : failure("INVALID_INPUT", "请求参数不合法", 400);
  }

  const locale = parsed.data.locale ?? normalizeLocale(req.cookies.get(LOCALE_COOKIE)?.value);
  try {
    const { delivery } = await requestPasswordReset({
      email: parsed.data.email,
      ip: clientIpFromHeaders(req.headers),
      locale,
    });
    return NextResponse.json({ ok: true, delivery });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return failure("RATE_LIMITED", error.message, 429, { "Retry-After": "3600" });
    }
    throw error;
  }
}
