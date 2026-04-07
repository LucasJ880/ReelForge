import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "20");

  const where = status ? { status: status as never } : {};

  const [projects, total] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        contentPlan: { select: { id: true, caption: true, createdAt: true } },
        videoJob: { select: { id: true, status: true, videoUrl: true } },
        publication: { select: { id: true, publishStatus: true, publishedAt: true } },
        analysisReport: { select: { id: true } },
      },
    }),
    db.project.count({ where }),
  ]);

  return NextResponse.json({ projects, total, page, pageSize });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { keyword } = body;

  if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
    return NextResponse.json(
      { error: "请输入关键词" },
      { status: 400 }
    );
  }

  const project = await db.project.create({
    data: { keyword: keyword.trim() },
  });

  return NextResponse.json(project, { status: 201 });
}
