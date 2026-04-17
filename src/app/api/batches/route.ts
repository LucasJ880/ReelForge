import { NextRequest, NextResponse } from "next/server";
import { createBatch, listBatches, executeBatch } from "@/lib/services/batch-service";
import { handleApiError } from "@/lib/utils/api-error";
import { requireAdmin } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "20");

  const result = await listBatches(page, pageSize);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const { name, keywords, brandDescription, tone, language, brandLock, videoParams, concurrency, autoGenerateVideo, autoStart } = body;

    const VALID_TONES = ["auto", "promo", "narrative", "educational", "vlog", "news", "humor", "cinematic", "testimonial"];
    const VALID_LANGUAGES = ["auto", "en", "zh", "ja", "ko", "es", "fr", "de"];
    const VALID_TEMPLATES = ["none", "corner_watermark", "intro_outro", "full_package"];
    const VALID_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"];

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "请输入批次名称" }, { status: 400 });
    }

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: "请输入至少一个关键词" }, { status: 400 });
    }

    const validKeywords = keywords
      .map((k: unknown) => (typeof k === "string" ? k.trim() : ""))
      .filter(Boolean);

    if (validKeywords.length === 0) {
      return NextResponse.json({ error: "请输入有效关键词" }, { status: 400 });
    }

    const bl = brandLock && typeof brandLock === "object" ? brandLock : {};
    const brandLockInput = {
      logoUrl:
        typeof bl.logoUrl === "string" && bl.logoUrl.startsWith("http")
          ? bl.logoUrl
          : null,
      enabled: bl.enabled !== false,
      template:
        typeof bl.template === "string" && VALID_TEMPLATES.includes(bl.template)
          ? bl.template
          : "corner_watermark",
      position:
        typeof bl.position === "string" && VALID_POSITIONS.includes(bl.position)
          ? bl.position
          : "bottom-right",
      opacity:
        typeof bl.opacity === "number"
          ? Math.max(0, Math.min(100, Math.round(bl.opacity)))
          : 85,
    };

    const batch = await createBatch({
      name,
      keywords: validKeywords,
      brandDescription:
        typeof brandDescription === "string" && brandDescription.trim()
          ? brandDescription.trim()
          : null,
      tone: typeof tone === "string" && VALID_TONES.includes(tone) ? tone : "auto",
      language: typeof language === "string" && VALID_LANGUAGES.includes(language) ? language : "auto",
      brandLock: brandLockInput,
      videoParams,
      concurrency: concurrency ?? 2,
      autoGenerateVideo: autoGenerateVideo ?? true,
    });

    if (autoStart !== false) {
      executeBatch(batch.id).catch((err) => {
        console.error(`[batch:${batch.id}] 自动执行失败:`, err);
      });
    }

    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    return handleApiError(error, "批次创建");
  }
}
