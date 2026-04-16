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
        product: { select: { id: true, name: true, productLine: true, color: true } },
        contentPlan: { select: { id: true, caption: true, createdAt: true } },
        videoJob: { select: { id: true, status: true, videoUrl: true, thumbnailUrl: true } },
        publication: {
          select: { id: true, publishStatus: true, publishedAt: true },
        },
        analysisReport: { select: { id: true, overallScore: true } },
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
  const { keyword, productId, trendRefId, imageUrls, primaryImageUrl } = body;

  if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
    return NextResponse.json(
      { error: "请输入关键词" },
      { status: 400 }
    );
  }

  if (productId) {
    const product = await db.productCatalog.findUnique({
      where: { id: productId },
    });
    if (!product || !product.isActive) {
      return NextResponse.json(
        { error: "所选产品不存在或已下架" },
        { status: 400 }
      );
    }
  }

  const validImageUrls = Array.isArray(imageUrls)
    ? imageUrls.filter((u: unknown) => typeof u === "string" && u.startsWith("http"))
    : [];

  const project = await db.project.create({
    data: {
      keyword: keyword.trim(),
      productId: productId || null,
      trendRefId: trendRefId || null,
      imageUrls: validImageUrls,
      primaryImageUrl: typeof primaryImageUrl === "string" ? primaryImageUrl : validImageUrls[0] || null,
    },
  });

  return NextResponse.json(project, { status: 201 });
}
