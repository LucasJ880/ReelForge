import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { revokePro } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  try {
    const user = await revokePro({
      userId: id,
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
