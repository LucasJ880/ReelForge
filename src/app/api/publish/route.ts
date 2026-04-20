import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import { listPendingPublish } from "@/lib/services/publish-service";

export async function GET(_req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const items = await listPendingPublish();
  return NextResponse.json({ items });
}
