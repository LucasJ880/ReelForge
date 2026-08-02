import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { customerApiError } from "@/lib/api/customer-generation-error";
import { productImageJobView } from "@/app/api/product-images/route";
import {
  cancelProductImageJob,
  ProductImageRequestError,
} from "@/lib/services/product-image-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 取消这一轮产品图（铁律 #7：每一轮任务都必须可取消）。
 * 永远免费：取消不计费；已产出素材保留；幂等键被改写，
 * 商家可立刻用同样输入重新发起。
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  try {
    const job = await cancelProductImageJob({
      jobId: id,
      userId: guard.session.user.id,
    });
    return NextResponse.json({ ok: true, job: productImageJobView(job) });
  } catch (error) {
    if (error instanceof ProductImageRequestError) {
      return NextResponse.json(
        customerApiError({
          code:
            error.code === "NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "INVALID_STATE",
          message: error.message,
          retryable: false,
          action:
            error.code === "NOT_FOUND" ? "contact_support" : "refresh_status",
        }),
        { status: error.status },
      );
    }
    console.error("[product-images:cancel] failed", { id, error });
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "暂时无法取消，请稍后再试。",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}
