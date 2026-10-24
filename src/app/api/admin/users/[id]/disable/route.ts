import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/api-auth";
import {
  AccountDisableError,
  DISABLE_REASON_MAX_LENGTH,
  disableAccount,
  enableAccount,
} from "@/lib/services/account-disable-service";

const disableSchema = z.object({
  reason: z.string().trim().min(1).max(DISABLE_REASON_MAX_LENGTH),
});

/**
 * /api/admin/users/[id]/disable —— 账号停用（取代删除，A4 5.1）。仅 SUPER_ADMIN。
 *
 * POST   停用：不能停用自己；必须写原因（留痕）。即时生效：登录被拒、API 守卫立即
 *        拒绝已有会话；同一事务取消该用户未提交给供应商的排队任务（只改状态）。
 * DELETE 解除停用（恢复）：只清停用标记，数据本来就都在；停用时取消的任务不会复活。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const parsed = disableSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "VALIDATION_FAILED",
        error: `请填写停用原因（1–${DISABLE_REASON_MAX_LENGTH} 字）`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await disableAccount({
      targetUserId: id,
      actorUserId: guard.session.user.id,
      reason: parsed.data.reason,
    });
    return NextResponse.json({
      ok: true,
      userId: result.userId,
      disabledAt: result.disabledAt.toISOString(),
      alreadyDisabled: result.alreadyDisabled,
      cancelledVideoJobs: result.cancelledVideoJobs,
    });
  } catch (err) {
    if (err instanceof AccountDisableError) {
      return NextResponse.json(
        { ok: false, code: err.reason.toUpperCase(), error: err.message },
        { status: err.reason === "not_found" ? 404 : 400 },
      );
    }
    throw err;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    const result = await enableAccount({ targetUserId: id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AccountDisableError && err.reason === "not_found") {
      return NextResponse.json(
        { ok: false, code: "NOT_FOUND", error: err.message },
        { status: 404 },
      );
    }
    throw err;
  }
}
