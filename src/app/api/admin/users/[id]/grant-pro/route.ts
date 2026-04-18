import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { grantPro } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: { days?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const days = Number.isFinite(body.days) ? Math.max(1, Math.floor(body.days!)) : 30;

  try {
    const user = await grantPro({
      userId: id,
      days,
      source: "admin-manual",
      grantedBy: guard.session.user.id,
    });
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        planTier: user.planTier,
        planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "操作失败" },
      { status: 400 },
    );
  }
}
