import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePro } from "@/lib/api-auth";
import { deleteProjectWithAssets } from "@/lib/services/project-service";

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
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json(project);
}

// 仅 ADMIN 可切换的字段（业务安全：私有化是发布动作）
const ADMIN_ONLY_PATCH_FIELDS = new Set(["isPublic"]);

const ALLOWED_PATCH_FIELDS = new Set([
  "keyword",
  "brandDescription",
  "tone",
  "language",
  "logoUrl",
  "brandLockEnabled",
  "brandLockTemplate",
  "brandLockPosition",
  "brandLockOpacity",
  "brandLockSlogan",
  "isPublic",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await request.json();

  const data: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) continue;
    if (
      ADMIN_ONLY_PATCH_FIELDS.has(key) &&
      guard.session.user.role !== "ADMIN"
    ) {
      return NextResponse.json(
        { error: `字段 ${key} 仅管理员可修改` },
        { status: 403 },
      );
    }
    data[key] = body[key];
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效字段" }, { status: 400 });
  }

  try {
    const project = await db.project.update({ where: { id }, data });
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 删除视为写操作 —— 需要 PRO；ADMIN 自动满足
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  try {
    const result = await deleteProjectWithAssets(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[DELETE project]", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}

