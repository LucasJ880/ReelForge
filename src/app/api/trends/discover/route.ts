import { NextRequest, NextResponse } from "next/server";
import { discoverTrends } from "@/lib/services/trend-service";
import { handleApiError } from "@/lib/utils/api-error";
import type { Platform } from "@/lib/providers/apify-search";
import { requireAdmin } from "@/lib/api-auth";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const { keyword, platforms, limit } = body as {
      keyword?: string;
      platforms?: Platform[];
      limit?: number;
    };

    if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
      return NextResponse.json({ error: "请输入搜索关键词" }, { status: 400 });
    }

    const validPlatforms: Platform[] = ["tiktok", "instagram", "facebook"];
    const selectedPlatforms = platforms?.filter((p) => validPlatforms.includes(p));

    const candidates = await discoverTrends(keyword.trim(), {
      platforms: selectedPlatforms?.length ? selectedPlatforms : undefined,
      limitPerPlatform: limit ?? 50,
    });

    return NextResponse.json({
      keyword: keyword.trim(),
      platforms: selectedPlatforms ?? validPlatforms,
      total: candidates.length,
      candidates,
    });
  } catch (error) {
    return handleApiError(error, "爆款搜索");
  }
}
