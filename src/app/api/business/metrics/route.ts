import { NextRequest, NextResponse } from "next/server";
import { requireBusinessUser } from "@/lib/api-auth";
import { importBusinessVideoMetrics } from "@/lib/services/business-metrics-import";
import { businessMetricsImportSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  const guard = await requireBusinessUser();
  if (!guard.ok) return guard.response;

  const body = await req.json();
  const parsed = businessMetricsImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const snap = await importBusinessVideoMetrics({
      userId: guard.session.user.id!,
      briefId: parsed.data.briefId,
      windowHours: parsed.data.windowHours,
      metrics: parsed.data.metrics,
      publishUrl: parsed.data.publishUrl ?? null,
    });
    return NextResponse.json({ ok: true, snapshot: snap });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
