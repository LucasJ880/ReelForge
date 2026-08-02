import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { cancelBrollDelivery } from "@/lib/services/broll-assembly-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cancelSchema = z.object({
  briefId: z.string().trim().min(1),
});

/**
 * b-roll 任务取消（铁律 #7）：素材与口播音频保留，仅终止合成。
 * 只对本人创建、路线为 broll、尚未完成的任务生效。
 */
export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_FAILED", error: "参数不合法" },
      { status: 400 },
    );
  }

  const result = await cancelBrollDelivery({
    userId: guard.session.user.id,
    briefId: parsed.data.briefId,
  });
  if (!result.ok) {
    const status =
      result.reason === "not_found" ? 404 : result.reason === "not_broll" ? 422 : 409;
    const message =
      result.reason === "not_found"
        ? "任务不存在或不属于当前账号"
        : result.reason === "not_broll"
          ? "该任务不是实拍图库线路，请在对应详情页操作"
          : "任务已经完成或失败，无需取消";
    return NextResponse.json(
      { ok: false, code: result.reason.toUpperCase(), error: message },
      { status },
    );
  }
  return NextResponse.json({ ok: true, state: result.state });
}
