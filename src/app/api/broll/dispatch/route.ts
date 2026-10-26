import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { rateLimitedResponse } from "@/lib/api-rate-limit";
import { demoBlockedBody, isDemoAccountEmail } from "@/lib/demo-account";
import {
  isBrollRouteAvailable,
  startBrollDelivery,
} from "@/lib/services/broll-assembly-service";
import { BrollPlanError } from "@/lib/services/broll-plan-service";
import { assertPaidActionRateLimit } from "@/lib/services/paid-action-rate-limit";
import { isProviderBillingError } from "@/lib/providers/provider-billing-error";
import { featureGate } from "@/lib/capabilities/registry";
import { getCapabilities } from "@/lib/services/capability-status-service";
import { getServerLocale } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/// 提交层要做 LLM 拆段 + 逐段 TTS + 上传，串行约 10-30s。
export const maxDuration = 120;

/// 演示账号不跑付费生成（铁律 #4）：TTS 按量计费。middleware 已统一拦写请求，这里是第二道。

const dispatchSchema = z.object({
  script: z
    .string()
    .trim()
    .min(20, "口播稿至少 20 字才能拆出镜头段")
    .max(2000),
  aspectRatio: z.enum(["9:16", "16:9"]),
  title: z.string().trim().max(120).optional(),
  voiceId: z.string().trim().max(80).optional(),
  bgmTrackId: z.enum(["none", "wholesome"]).optional(),
  captionsEnabled: z.boolean().optional(),
});

/**
 * b-roll 实拍图库线路 · 创作页提交入口。
 *
 * 同步完成：拆段（LLM）→ 图库选片 → 逐段 TTS → 上传输入 → 建 PENDING 数据链。
 * 合成异步：本地 dev 进程内推进；生产由 stitch-dispatch cron 派 GH runner。
 * 返回后成品库「生产线上」立即可见；取消走 /api/broll/cancel。
 */
export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const session = guard.session;

  if (isDemoAccountEmail(session.user.email)) {
    return NextResponse.json(demoBlockedBody(), { status: 403 });
  }

  if (!isBrollRouteAvailable()) {
    return NextResponse.json(
      {
        ok: false,
        code: "ROUTE_UNAVAILABLE",
        error: "实拍图库线路尚未配置齐全（图库 key 或 TTS 权限缺失）。",
        retryable: false,
      },
      { status: 503 },
    );
  }

  /// C4：能力注册表说拆段（AI 写作）/ 配音 / 图库有一项暂停，就在拆段与 TTS 花钱之前说清楚，
  /// 不再等 LLM 或 TTS 真的失败后才 503（1025 真机验收：额度用完时提交后才报错）。
  const brollGate = featureGate(await getCapabilities(), "broll");
  if (brollGate.status === "blocked") {
    const locale = await getServerLocale();
    return NextResponse.json(
      {
        ok: false,
        code: "CAPABILITY_UNAVAILABLE",
        error: brollGate.message?.[locale] ?? "实拍图库线路暂停，恢复后自动开放。",
        blockedBy: brollGate.blockedBy,
        retryable: false,
      },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = dispatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "VALIDATION_FAILED",
        error: "参数不合法",
        issues: parsed.error.flatten(),
        retryable: false,
      },
      { status: 400 },
    );
  }

  /// 按用户每小时限流（D5）：校验通过之后、拆段 / TTS 花钱之前。
  try {
    await assertPaidActionRateLimit({ action: "broll", userId: session.user.id });
  } catch (err) {
    const limited = rateLimitedResponse(err);
    if (limited) return limited;
    throw err;
  }

  try {
    const result = await startBrollDelivery({
      userId: session.user.id,
      ...parsed.data,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      nextUrl: "/app/library",
    });
  } catch (err) {
    if (err instanceof BrollPlanError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.reason.toUpperCase(),
          error: err.message,
          /// llm_unavailable 是运行时抖动可重试；素材缺段要改稿，不可原样重试
          retryable: err.reason === "llm_unavailable",
        },
        { status: err.reason === "llm_unavailable" ? 503 : 422 },
      );
    }
    console.error("[broll/dispatch] failed:", (err as Error).message);
    if (isProviderBillingError(err)) {
      return NextResponse.json(
        {
          ok: false,
          code: "PROVIDER_UNAVAILABLE",
          error: "实拍图库线路暂时不可用：AI 拆段与配音服务正在恢复，我们已在处理。可以先用上方主线生成视频。",
          retryable: false,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL_ERROR",
        error: "提交失败，请稍后重试；连续失败请联系支持。",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
