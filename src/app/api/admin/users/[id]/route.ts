import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireSuperAdmin } from "@/lib/api-auth";
import { forgetAccountStatus } from "@/lib/auth";
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
  /// 改角色在本实例立即生效（其他实例 API 守卫本来就查库，页面最多 5 分钟）。
  forgetAccountStatus(user.id);
  return NextResponse.json(user);
}

/**
 * 删除用户已下线（A4 5.1）：物理删除会沿级联删光客户全部业务数据，违反铁律 §4.2。
 * 改用 POST /api/admin/users/[id]/disable（停用，数据全保留，可恢复）。
 */
export async function DELETE() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json(
    {
      ok: false,
      code: "METHOD_NOT_ALLOWED",
      error: "不再支持删除账号：请改用「停用」，账号数据会全部保留、可随时恢复。",
    },
    { status: 405, headers: { Allow: "PATCH" } },
  );
}
