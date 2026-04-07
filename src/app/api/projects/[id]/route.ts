import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await db.project.findUnique({
    where: { id },
    include: {
      contentPlan: true,
      videoJob: true,
      publication: {
        include: {
          snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
        },
      },
      analysisReport: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const project = await db.project.update({
    where: { id },
    data: body,
  });

  return NextResponse.json(project);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await db.project.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
