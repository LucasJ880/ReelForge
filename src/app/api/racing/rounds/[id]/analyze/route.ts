import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  analyzeRacingRound,
  isInternalRacingUser,
} from "@/lib/services/racing-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const report = await analyzeRacingRound(id, {
      userId: guard.session.user.id!,
      canViewAll: isInternalRacingUser(guard.session.user.userType),
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
