import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { quotaErrorResponse } from "@/lib/api-quota";
import { assertRegisterRateLimit } from "@/lib/services/quota-service";

/**
 * POST /api/auth/register
 *
 * 公开个人用户自助注册。**只创建 PERSONAL 账号**。
 * 业务（BUSINESS）账号仍是 invite-only，由 admin 在 /settings 创建。
 *
 * Body:
 *   { email: string, password: string, name?: string }
 *
 * 返回：
 *   { ok: true } —— 注册成功；前端调用 next-auth signIn() 完成登录
 *   { ok: false, error: ... } —— 邮箱已占用 / 验证失败 / 限流
 *
 * 安全：
 *   - 密码 ≥ 8 字符；bcrypt 12 轮
 *   - 重复邮箱返回与"密码弱"等通用 4xx，避免邮箱枚举（Phase 5 简单实现：
 *     直接返回明确错误，因为 MVP 阶段没有 magic-link / 邮箱验证流程，
 *     枚举风险可接受）
 *   - 默认 role = OPERATOR（schema default），但 userType=PERSONAL，
 *     因此 requireOperator() / requireReviewer() / requireInternal() 都会拒绝
 *     这个账号，避免被误授予 admin 权限
 *
 * Phase 7 才加 quota / 邮箱验证 / 频率限制；Phase 8.5 加法务勾选
 */
const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("请输入有效的邮箱"),
  password: z
    .string()
    .min(8, "密码至少 8 位")
    .max(128, "密码过长"),
  name: z
    .string()
    .trim()
    .max(80, "昵称过长")
    .optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "请求格式错误" },
      { status: 400 },
    );
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: first?.message ?? "注册参数不合法" },
      { status: 400 },
    );
  }

  const { email, password, name } = parsed.data;

  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;
    await assertRegisterRateLimit({ ip, email });
  } catch (err) {
    const quotaRes = quotaErrorResponse(err);
    if (quotaRes) return quotaRes;
    throw err;
  }

  const existing = await db.adminUser.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "该邮箱已注册，请直接登录" },
      { status: 409 },
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.adminUser.create({
    data: {
      email,
      hashedPassword,
      name: name && name.length > 0 ? name : email.split("@")[0],
      /// role 用 schema default = OPERATOR；persona-aware guard 会用 userType 拒绝
      /// 当前账号访问 /internal/* 等管理端点
      userType: "PERSONAL",
    },
  });

  return NextResponse.json({ ok: true, persona: "PERSONAL" });
}
