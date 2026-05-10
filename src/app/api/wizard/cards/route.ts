import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import {
  listCreativeEvidenceCards,
  recommendCreativeCards,
} from "@/lib/services/creative-evidence-service";
import {
  CREATIVE_INDUSTRIES,
  CREATIVE_OBJECTIVES,
  CREATIVE_PLATFORMS,
} from "@/lib/schemas/creative-evidence";

/**
 * GET /api/wizard/cards
 *
 * Query:
 *   - status:    DRAFT | REVIEWED | PUBLISHED | ARCHIVED  (默认 PUBLISHED)
 *   - industry:  CreativeIndustry  (可选过滤)
 *   - platform:  CreativePlatform  (可选过滤)
 *   - objective: CreativeObjective (可选过滤)
 *   - recommend: "1" 时开启推荐排序，需配合 industry+objective+platform
 *   - limit:     1-50，默认 24
 */
const querySchema = z.object({
  status: z
    .enum(["DRAFT", "REVIEWED", "PUBLISHED", "ARCHIVED"])
    .default("PUBLISHED"),
  industry: z.enum(CREATIVE_INDUSTRIES).optional(),
  platform: z.enum(CREATIVE_PLATFORMS).optional(),
  objective: z.enum(CREATIVE_OBJECTIVES).optional(),
  recommend: z.enum(["0", "1"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export async function GET(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const q = parsed.data;

  if (q.recommend === "1") {
    if (!q.industry || !q.objective || !q.platform) {
      return NextResponse.json(
        {
          error:
            "recommend=1 需要同时提供 industry / objective / platform 三个参数",
        },
        { status: 400 },
      );
    }
    const recs = await recommendCreativeCards({
      industry: q.industry,
      objective: q.objective,
      platform: q.platform,
      limit: q.limit,
    });
    return NextResponse.json({ items: recs, mode: "recommended" });
  }

  const result = await listCreativeEvidenceCards({
    status: q.status,
    industry: q.industry,
    platform: q.platform,
    objective: q.objective,
    limit: q.limit,
  });
  return NextResponse.json({ items: result.items, total: result.total, mode: "list" });
}
