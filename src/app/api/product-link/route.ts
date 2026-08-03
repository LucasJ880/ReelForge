import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import {
  factsToPromptLines,
  fetchProductFacts,
  ProductLinkError,
} from "@/lib/services/product-link-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/// 直抓 8s 超时 + Firecrawl 兜底 20s，留足余量。
export const maxDuration = 60;

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
});

/**
 * 链接起片（PRD O1：商品链接是 P0 输入之一）。
 * 抓取商品页事实（Shopify JSON → 直抓 → Firecrawl 兜底）并转成提示词行，
 * 供创作页预填。只读，不建任何记录。
 */
export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_FAILED", error: "请粘贴一个商品页链接" },
      { status: 400 },
    );
  }

  try {
    const facts = await fetchProductFacts(parsed.data.url);
    return NextResponse.json({
      ok: true,
      facts,
      promptText: factsToPromptLines(facts).join("\n"),
    });
  } catch (err) {
    if (err instanceof ProductLinkError) {
      return NextResponse.json(
        { ok: false, code: err.reason.toUpperCase(), error: err.message },
        { status: 422 },
      );
    }
    console.error("[product-link] failed:", (err as Error).message);
    return NextResponse.json(
      { ok: false, code: "INTERNAL_ERROR", error: "抓取失败，请稍后重试" },
      { status: 500 },
    );
  }
}
