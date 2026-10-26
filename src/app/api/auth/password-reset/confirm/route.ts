import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { PasswordResetConfirmErrorCode } from "@/i18n/password-reset-copy";
import { confirmPasswordReset } from "@/lib/services/password-reset-service";
import { readLimitedJson, resetFailure } from "../_shared";

export const dynamic = "force-dynamic";

/// 长度与格式由 service 判（密码规则 → WEAK_PASSWORD，令牌格式 → INVALID_OR_EXPIRED）；体积上限挡住超大请求体
const confirmSchema = z.object({
  token: z.string(),
  password: z.string(),
});

const failure = resetFailure<PasswordResetConfirmErrorCode>;

/**
 * POST /api/auth/password-reset/confirm —— 用邮件里的链接设置新密码。
 *
 * Body: { token: string, password: string }
 *
 * 返回：
 *   200 { ok: true }                               —— 密码已更新，令牌已用掉（只能用一次）
 *   400 { ok: false, code: "INVALID_OR_EXPIRED" }  —— 令牌不存在 / 已用 / 已过期 / 账号已停用
 *   400 { ok: false, code: "WEAK_PASSWORD" }       —— 不满足密码规则（8–128 位）
 *   400 { ok: false, code: "INVALID_INPUT" }
 */
export async function POST(req: NextRequest) {
  const read = await readLimitedJson(req);
  if (!read.ok) return failure("INVALID_INPUT", "请求格式错误", 400);

  const parsed = confirmSchema.safeParse(read.body);
  if (!parsed.success) return failure("INVALID_INPUT", "请求参数不合法", 400);

  const result = await confirmPasswordReset(parsed.data);
  if (!result.ok) {
    return result.reason === "weak_password"
      ? failure("WEAK_PASSWORD", "密码至少 8 位，最多 128 位", 400)
      : failure("INVALID_OR_EXPIRED", "重置链接已失效，请重新获取", 400);
  }
  return NextResponse.json({ ok: true });
}
