import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const sort = searchParams.get("sort") || "newest";
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "20");

  const where: Prisma.ProjectWhereInput = {};

  if (status) where.status = status as never;
  if (category === "__none") where.category = null;
  else if (category) where.category = category;
  if (search) {
    where.OR = [
      { keyword: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
      { contentPlan: { caption: { contains: search, mode: "insensitive" } } },
    ];
  }

  const orderBy: Prisma.ProjectOrderByWithRelationInput =
    sort === "oldest" ? { createdAt: "asc" } :
    sort === "keyword" ? { keyword: "asc" } :
    sort === "status" ? { status: "asc" } :
    { createdAt: "desc" };

  const [projects, total, categoryStats] = await Promise.all([
    db.project.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        contentPlan: { select: { id: true, caption: true, createdAt: true } },
        videoJob: {
          select: {
            id: true,
            status: true,
            videoUrl: true,
            videoUrl2: true,
            stitchedVideoUrl: true,
            thumbnailUrl: true,
          },
        },
      },
    }),
    db.project.count({ where }),
    db.project.groupBy({
      by: ["category"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
  ]);

  const categories = categoryStats
    .filter((c) => c.category !== null)
    .map((c) => ({ name: c.category as string, count: c._count.id }));

  return NextResponse.json({
    projects,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    categories,
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const {
    keyword,
    brandDescription,
    imageUrls,
    primaryImageUrl,
    tone,
    language,
    logoUrl,
    brandLockEnabled,
    brandLockTemplate,
    brandLockPosition,
    brandLockOpacity,
    brandLockSlogan,
  } = body;

  if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
    return NextResponse.json(
      { error: "请输入关键词" },
      { status: 400 }
    );
  }

  const VALID_TONES = ["auto", "promo", "narrative", "educational", "vlog", "news", "humor", "cinematic", "testimonial"];
  const VALID_LANGUAGES = ["auto", "en", "zh", "ja", "ko", "es", "fr", "de"];
  const VALID_TEMPLATES = ["none", "corner_watermark", "intro_outro", "full_package"];
  const VALID_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"];

  const validImageUrls = Array.isArray(imageUrls)
    ? imageUrls.filter((u: unknown) => typeof u === "string" && u.startsWith("http"))
    : [];

  const opacity =
    typeof brandLockOpacity === "number"
      ? Math.max(0, Math.min(100, Math.round(brandLockOpacity)))
      : 85;

  const project = await db.project.create({
    data: {
      keyword: keyword.trim(),
      brandDescription:
        typeof brandDescription === "string" && brandDescription.trim()
          ? brandDescription.trim()
          : null,
      tone: typeof tone === "string" && VALID_TONES.includes(tone) ? tone : "auto",
      language: typeof language === "string" && VALID_LANGUAGES.includes(language) ? language : "auto",
      imageUrls: validImageUrls,
      primaryImageUrl: typeof primaryImageUrl === "string" ? primaryImageUrl : validImageUrls[0] || null,
      logoUrl: typeof logoUrl === "string" && logoUrl.startsWith("http") ? logoUrl : null,
      brandLockEnabled: brandLockEnabled !== false,
      brandLockTemplate:
        typeof brandLockTemplate === "string" && VALID_TEMPLATES.includes(brandLockTemplate)
          ? brandLockTemplate
          : "corner_watermark",
      brandLockPosition:
        typeof brandLockPosition === "string" && VALID_POSITIONS.includes(brandLockPosition)
          ? brandLockPosition
          : "bottom-right",
      brandLockOpacity: opacity,
      brandLockSlogan:
        typeof brandLockSlogan === "string" && brandLockSlogan.trim()
          ? brandLockSlogan.trim().slice(0, 100)
          : null,
    },
  });

  return NextResponse.json(project, { status: 201 });
}
