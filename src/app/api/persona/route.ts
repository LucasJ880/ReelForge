import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { db } from "@/lib/db";

const personaSchema = z.object({
  persona: z.enum(["BUSINESS", "PERSONAL"]),
});

/**
 * POST /api/persona
 *
 * Body: { persona: "BUSINESS" | "PERSONAL" }
 *
 * 把 AdminUser.userType 写到指定 persona。
 *
 * Phase 1：所有登录用户都能选；Phase 2 加上 "OPERATOR/SUPER_ADMIN 选了 BUSINESS/PERSONAL
 * 之后是否要保留 internal access" 的策略（默认保留：root page 仍允许从 /internal/* 切回）。
 */
export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = personaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid persona", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await db.adminUser.update({
    where: { id: guard.session.user.id },
    data: { userType: parsed.data.persona },
  });

  return NextResponse.json({ ok: true, persona: parsed.data.persona });
}
