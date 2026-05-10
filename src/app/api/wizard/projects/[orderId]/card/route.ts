import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import { selectCreativeCard } from "@/lib/services/client-project-service";

/**
 * POST /api/wizard/projects/:orderId/card
 * Body: { slug: string }
 *
 * 选定一张创意证据卡 —— 走 selectCreativeCard，会校验 slug 存在性，
 * 同时同步 clientBrief.selectedCardSlug 与 deliveryOrder.selectedCreativeCardId。
 */
const bodySchema = z.object({
  slug: z.string().min(3).max(80),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const updated = await selectCreativeCard(orderId, parsed.data.slug);
    return NextResponse.json({
      id: updated.id,
      selectedCreativeCardId: updated.selectedCreativeCardId,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "选卡失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}
