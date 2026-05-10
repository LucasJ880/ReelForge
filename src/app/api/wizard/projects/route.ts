import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireOperator } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { initClientProject } from "@/lib/services/client-project-service";
import {
  clientBriefSchema,
  type ClientBrief,
} from "@/lib/schemas/client-brief";

/**
 * POST /api/wizard/projects
 * 创建一个新的 wizard 项目（DeliveryOrder + clientBrief）。
 *
 * Body: { brief: ClientBrief, title?: string, maxRounds?: number }
 *
 * 校验：
 * - brief 必须通过 clientBriefSchema 完整 parse；
 * - 三项 consent 必须全部 true（向导第一步要求）；
 * - 创建者从 session 取。
 */
const createProjectSchema = z.object({
  title: z.string().min(2).max(160).optional(),
  brief: clientBriefSchema,
  maxRounds: z.number().int().min(1).max(5).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const consentError = validateConsents(parsed.data.brief);
  if (consentError) {
    return NextResponse.json(
      { error: "需要确认所有合规承诺", details: consentError },
      { status: 400 },
    );
  }

  try {
    const order = await initClientProject({
      title: parsed.data.title,
      brief: parsed.data.brief,
      maxRounds: parsed.data.maxRounds,
      createdById: guard.session.user.id,
    });
    return NextResponse.json(
      { id: order.id, title: order.title, createdAt: order.createdAt },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "创建项目失败", message: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/wizard/projects?limit=N
 * 列出当前用户可见的 wizard 项目（即 clientBrief 非空的 DeliveryOrder）。
 */
export async function GET(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 30), 1),
    100,
  );

  // 用 Prisma.DbNull 而非字面量 null：后者在 Prisma 6 已废弃，
  // 且语义是「不是 JSON null 字面量」而非「不是 SQL NULL」。
  const orders = await db.deliveryOrder.findMany({
    where: { NOT: { clientBrief: { equals: Prisma.DbNull } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      selectedCreativeCardId: true,
    },
  });
  return NextResponse.json({ items: orders });
}

function validateConsents(brief: ClientBrief) {
  const missing: string[] = [];
  if (!brief.consents.ownsFootage) missing.push("ownsFootage");
  if (!brief.consents.noUnauthorizedAvatar) missing.push("noUnauthorizedAvatar");
  if (!brief.consents.noUnauthorizedVoiceClone) {
    missing.push("noUnauthorizedVoiceClone");
  }
  if (missing.length === 0) return null;
  return { missing };
}
