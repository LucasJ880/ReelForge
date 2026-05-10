import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import {
  getClientProject,
  writeClientBriefToOrder,
} from "@/lib/services/client-project-service";
import { clientBriefPatchSchema } from "@/lib/schemas/client-brief";

/**
 * GET /api/wizard/projects/:orderId
 * 返回当前 wizard 项目（含 brief 解析后形态 + 选中卡片）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;
  const project = await getClientProject(orderId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json(project);
}

/**
 * PATCH /api/wizard/projects/:orderId
 * Body: ClientBriefPatch
 *
 * 走 writeClientBriefToOrder(mode='patch') —— 强制 zod 校验，
 * 且双重 partial parse 防止脏字段进入 JSON。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { orderId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = clientBriefPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const updated = await writeClientBriefToOrder(orderId, parsed.data, "patch");
    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "更新失败", message: (err as Error).message },
      { status: 400 },
    );
  }
}
