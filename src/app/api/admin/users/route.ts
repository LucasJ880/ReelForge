import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { listUsersForAdmin } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const search = req.nextUrl.searchParams.get("q")?.trim() || undefined;
  const users = await listUsersForAdmin(search);
  return NextResponse.json({ users });
}
