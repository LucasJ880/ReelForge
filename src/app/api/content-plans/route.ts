import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { customerApiError } from "@/lib/api/customer-generation-error";
import {
  createContentPlan,
  listContentPlans,
} from "@/lib/services/content-plan-store";
import { ProductLinkError } from "@/lib/services/product-link-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O1 · 一句话进，多形态出（PRD §3 / M3）。
 *
 * 生成一周计划不计费：成本只有一次 LLM 调用，对它收费等于惩罚迭代。
 * 花钱的是出图，计费在渲染那一步。
 */

const createSchema = z.object({
  source: z.enum(["sentence", "product_image", "product_url"]).default("sentence"),
  /// 一句话原文 / 商品链接 / 产品图 URL
  input: z.string().min(1).max(2000),
  industry: z.string().max(100).nullish(),
  platform: z.string().max(50).nullish(),
  brandName: z.string().max(100).nullish(),
  idempotencyKey: z.string().min(8).max(200).nullish(),
});

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      customerApiError({
        code: "VALIDATION_FAILED",
        message: "请先用一句话说清楚你家做什么生意",
        retryable: false,
        action: "fix_request",
      }),
      { status: 400 },
    );
  }

  try {
    const plan = await createContentPlan({
      userId: guard.session.user.id,
      source: parsed.data.source,
      sourceInput: parsed.data.input,
      industry: parsed.data.industry,
      platform: parsed.data.platform,
      brandName: parsed.data.brandName,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    /// 链接抓取失败是**商家可以自己解决**的问题（换链接 / 改用一句话），
    /// 所以给具体原因而不是「生成失败」。
    if (err instanceof ProductLinkError) {
      return NextResponse.json(
        customerApiError({
          code: "VALIDATION_FAILED",
          message: `${err.message}。也可以直接用一句话描述你的生意。`,
          retryable: false,
          action: "fix_request",
        }),
        { status: 400 },
      );
    }
    console.error("[content-plans] create failed:", err);
    return NextResponse.json(
      customerApiError({
        code: "INTERNAL_ERROR",
        message: "内容计划生成失败，请重试",
        retryable: true,
        action: "retry",
      }),
      { status: 500 },
    );
  }
}

export async function GET() {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const plans = await listContentPlans(guard.session.user.id);
  return NextResponse.json({ plans });
}
