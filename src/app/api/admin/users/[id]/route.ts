import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireSuperAdmin } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  if (body.role && ["SUPER_ADMIN", "OPERATOR", "REVIEWER"].includes(body.role)) {
    data.role = body.role;
  }
  if (typeof body.password === "string" && body.password.length >= 8) {
    data.hashedPassword = await bcrypt.hash(body.password, 10);
  }
  if (typeof body.name === "string") data.name = body.name;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }
  const user = await db.adminUser.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json(user);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (id === guard.session.user.id) {
    return NextResponse.json({ error: "不能删除自己" }, { status: 400 });
  }
  await db.adminUser.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
