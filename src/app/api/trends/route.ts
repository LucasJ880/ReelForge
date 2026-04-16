import { NextRequest, NextResponse } from "next/server";
import {
  createTrendFromUrl,
  listTrendReferences,
  analyzeAndSave,
} from "@/lib/services/trend-service";
import { isValidVideoUrl } from "@/lib/providers/trend-discovery";
import { handleApiError } from "@/lib/utils/api-error";
import type { TrendCandidate } from "@/lib/providers/apify-search";
import { requireAdmin } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get("platform") as "tiktok" | "instagram" | "facebook" | null;
    const search = searchParams.get("search") ?? undefined;
    const limit = Number(searchParams.get("limit")) || 50;

    const trends = await listTrendReferences({ platform: platform ?? undefined, search, limit });
    return NextResponse.json(trends);
  } catch (error) {
    return handleApiError(error, "获取参考库");
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();

    if (body.candidate) {
      const candidate = body.candidate as TrendCandidate;
      if (!candidate.sourceUrl) {
        return NextResponse.json({ error: "候选视频缺少 sourceUrl" }, { status: 400 });
      }
      const trendRef = await analyzeAndSave(candidate);
      return NextResponse.json(trendRef, { status: 201 });
    }

    const { url } = body;
    if (!url || typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "请输入视频链接" }, { status: 400 });
    }

    if (!isValidVideoUrl(url.trim())) {
      return NextResponse.json(
        { error: "请输入有效的视频链接（支持 TikTok / Instagram / Facebook）" },
        { status: 400 }
      );
    }

    const trendRef = await createTrendFromUrl(url.trim());
    return NextResponse.json(trendRef, { status: 201 });
  } catch (error) {
    return handleApiError(error, "爆款分析", [
      { match: "请输入有效的视频链接", status: 400 },
      { match: "oEmbed 请求失败", status: 502 },
    ]);
  }
}
