import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireSuperAdmin } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { createAdminSchema } from "@/lib/validators";

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const users = await db.adminUser.findMany({
    where: { role: { in: ["SUPER_ADMIN", "OPERATOR", "REVIEWER"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ items: users });
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const body = await req.json().catch(() => null);
  const parsed = createAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const exists = await db.adminUser.findUnique({
    where: { email: parsed.data.email },
  });
  if (exists) {
    return NextResponse.json({ error: "邮箱已存在" }, { status: 409 });
  }
  const hashed = await bcrypt.hash(parsed.data.password, 10);
  const user = await db.adminUser.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name ?? null,
      role: parsed.data.role,
      hashedPassword: hashed,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json(user, { status: 201 });
}
