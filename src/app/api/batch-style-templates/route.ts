import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";

export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const templates = await listActiveStyleTemplates();
  return NextResponse.json({ templates });
}
