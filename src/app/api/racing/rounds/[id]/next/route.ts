import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import {
  isInternalRacingUser,
  scheduleNextRacingRound,
} from "@/lib/services/racing-service";

const nextRoundSchema = z.object({ baseDistillationId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const parsed = nextRoundSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "缺少本轮蒸馏结果" }, { status: 400 });
  }
  const { id } = await params;
  try {
    const round = await scheduleNextRacingRound({
      roundId: id,
      access: {
        userId: guard.session.user.id!,
        canViewAll: isInternalRacingUser(guard.session.user.userType),
      },
      baseDistillationId: parsed.data.baseDistillationId,
    });
    return NextResponse.json({ ok: true, round });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
