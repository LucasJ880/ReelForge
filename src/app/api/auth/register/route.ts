import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { quotaErrorResponse } from "@/lib/api-quota";
import { TRIAL_SUBSCRIPTION_TIER } from "@/lib/config/quota-tiers";
import { assertRegisterRateLimit } from "@/lib/services/quota-service";
import { BUSINESS_INDUSTRIES } from "@/lib/onboarding/industries";
import { TERMS_VERSION, type RegisterErrorCode } from "@/i18n/onboarding-copy";

/**
 * POST /api/auth/register
 *
 * Phase 1 unified self-service registration. New users receive a CUSTOMER
 * role plus one starter Workspace; the temporary PERSONAL value remains only
 * until the approved legacy-test/route migration is completed.
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
 *   - role=CUSTOMER，绝不借用 OPERATOR 角色
 *
 * Phase 7 才加 quota / 邮箱验证 / 频率限制；Phase 8.5 加法务勾选
 *
 * D5（2026-10-25）：自助注册的新账号进入「试用」额度（每月 3 条视频 / 6 段画面），
 * 信号是 subscriptionTier = "trial"（见 quota-tiers）。Workspace 仍建 starter：
 * planId 有外键，且存量账号与脚本建的账号都不经过这里，额度不变。
 *
 * C1（1025 整合轮）：首页「免费试做 3 条」的入口。加店名、行业、城市与条款同意（存同意时间与条款版本）；
 * 工作区以店名命名，行业 / 城市进生意档案，注册后进 /app/welcome 上手向导。
 * 错误一律带 code，前端按语言出文案（error 字段保留中文，兼容旧调用方）。
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
  businessName: z.string().trim().min(1, "请填写店名").max(80, "店名过长"),
  industry: z.enum(BUSINESS_INDUSTRIES, { message: "请选择行业" }),
  city: z
    .string()
    .trim()
    .max(80, "城市名过长")
    .optional()
    .transform((value) => (value ? value : undefined)),
  acceptTerms: z.literal(true, { message: "请先勾选同意服务条款与隐私政策" }),
});

/** zod 的第一处问题 → 稳定的错误码（前端按语言出文案）。 */
function registerErrorCode(path: PropertyKey | undefined): RegisterErrorCode {
  switch (path) {
    case "email":
      return "INVALID_EMAIL";
    case "password":
      return "WEAK_PASSWORD";
    case "businessName":
      return "BUSINESS_REQUIRED";
    case "industry":
      return "INDUSTRY_REQUIRED";
    case "acceptTerms":
      return "TERMS_REQUIRED";
    default:
      return "INVALID_INPUT";
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT" satisfies RegisterErrorCode, error: "请求格式错误" },
      { status: 400 },
    );
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, code: registerErrorCode(first?.path[0]), error: first?.message ?? "注册参数不合法" },
      { status: 400 },
    );
  }

  const { email, password, name, businessName, industry, city } = parsed.data;

  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;
    await assertRegisterRateLimit({ ip, email });
  } catch (err) {
    const quotaRes = quotaErrorResponse(err);
    if (quotaRes) {
      /// 限流沿用配额错误体，补一个注册页认识的 code
      const body = (await quotaRes.json().catch(() => ({}))) as Record<string, unknown>;
      return NextResponse.json(
        { ...body, ok: false, code: "RATE_LIMITED" satisfies RegisterErrorCode },
        { status: quotaRes.status, headers: quotaRes.headers },
      );
    }
    throw err;
  }

  const existing = await db.adminUser.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { ok: false, code: "EMAIL_TAKEN" satisfies RegisterErrorCode, error: "该邮箱已注册，请直接登录" },
      { status: 409 },
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.adminUser.create({
    data: {
      email,
      hashedPassword,
      name: name && name.length > 0 ? name : email.split("@")[0],
      role: "CUSTOMER",
      // Temporary compatibility discriminator; removed after test-map review.
      userType: "PERSONAL",
      /// D5 试用额度标记；Stripe 订阅成功或超管手工转正时改写。
      subscriptionTier: TRIAL_SUBSCRIPTION_TIER,
      termsAcceptedAt: new Date(),
      termsVersion: TERMS_VERSION,
      workspace: {
        create: {
          name: businessName,
          planId: "starter",
          isDefault: true,
          businessProfile: { industry, ...(city ? { city } : {}) },
        },
      },
    },
  });

  return NextResponse.json({ ok: true, persona: "PERSONAL" });
}
