import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { rateLimitedResponse } from "@/lib/api-rate-limit";
import { checkAdLawCopy } from "@/lib/compliance/ad-law-terms";
import { DOUYIN_PLATFORM, douyinKitRequestSchema } from "@/lib/contracts/douyin-publish-kit";
import { DouyinCopyError, generateDouyinCopy } from "@/lib/services/douyin-copy-service";
import {
  loadDouyinKitContext,
  toKitRegistration,
} from "@/lib/services/douyin-publish-kit-service";
import { assertPaidActionRateLimit } from "@/lib/services/paid-action-rate-limit";
import {
  cancelPlatformPublish,
  PublishAccountConflictError,
  PublishRegistrationInputError,
  PublishRegistrationUnavailableError,
  registerPlatformPublish,
} from "@/lib/services/publish-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/library/[id]/douyin-kit —— 抖音发布包里不跑 ffmpeg 的三个动作。
 * id = 成品库详情页的订单 id；只对本人、已成片的单条视频生效。
 *
 *   { action: "copy" }                                  AI 起一版标题 / 正文 / 话题（失败明确报错，不回退模板）
 *   { action: "register", accountLabel, publishUrl?, note? }
 *                                                       登记发到了哪个账号；这条成片已登记给别的账号 → 409
 *   { action: "unregister" }                            撤销登记（行保留，只改状态）
 *
 * 导出素材（封面 + 发布版成片）要跑 ffmpeg，在 /api/brand-packaging（请求体 { douyinKit }）。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const userId = guard.session.user.id;
  const { id } = await params;
  if (!id || id.length > 64) {
    return NextResponse.json({ ok: false, code: "VALIDATION_FAILED", error: "参数不合法" }, { status: 400 });
  }
  const parsed = douyinKitRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_FAILED", error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 },
    );
  }
  const context = await loadDouyinKitContext(userId, id);
  if (!context) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", error: "成片不存在、不属于当前账号，或还没有成片" },
      { status: 404 },
    );
  }
  const body = parsed.data;

  try {
    if (body.action === "copy") {
      await assertPaidActionRateLimit({ action: "douyin-kit-copy", userId });
      const { copy } = await generateDouyinCopy({
        productBrief: context.rawPrompt ?? context.title,
        voiceoverScript: context.voiceoverScript,
      });
      /// 起稿结果照样过极限词检查：命中词随文案一起返回，界面标红，改掉才能导出
      const adLaw = checkAdLawCopy(copy);
      return NextResponse.json({ ok: true, copy, adLaw: { ok: adLaw.ok, terms: adLaw.terms } });
    }

    if (body.action === "register") {
      const { record, created } = await registerPlatformPublish({
        videoBriefId: context.briefId,
        platform: DOUYIN_PLATFORM,
        accountLabel: body.accountLabel,
        publishUrl: body.publishUrl || null,
        operatorNote: body.note ?? null,
        publishedById: userId,
      });
      return NextResponse.json({ ok: true, created, registration: toKitRegistration(record) });
    }

    const { cancelled } = await cancelPlatformPublish({
      videoBriefId: context.briefId,
      platform: DOUYIN_PLATFORM,
    });
    return NextResponse.json({ ok: true, cancelled });
  } catch (err) {
    const limited = rateLimitedResponse(err);
    if (limited) return limited;
    if (err instanceof DouyinCopyError) {
      return NextResponse.json(
        { ok: false, code: "COPY_GENERATION_FAILED", error: err.message },
        { status: err.code === "INPUT_EMPTY" ? 422 : 502 },
      );
    }
    if (err instanceof PublishAccountConflictError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, existingAccountLabel: err.existingAccountLabel },
        { status: 409 },
      );
    }
    if (err instanceof PublishRegistrationInputError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 400 });
    }
    if (err instanceof PublishRegistrationUnavailableError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 503 });
    }
    console.error("[douyin-kit] request failed", err);
    return NextResponse.json({ ok: false, code: "RENDER_FAILED", error: "操作失败，请重试" }, { status: 500 });
  }
}
