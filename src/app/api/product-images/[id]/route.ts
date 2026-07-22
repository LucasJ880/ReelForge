import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { productImageJobView } from "@/app/api/product-images/route";
import { reconcileProductImageJob } from "@/lib/services/product-image-service";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const job = await reconcileProductImageJob(id, guard.session.user.id);
  if (!job) {
    return NextResponse.json(
      { ok: false, code: "RESOURCE_NOT_FOUND", error: "产品图任务不存在。" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, job: productImageJobView(job) });
}
