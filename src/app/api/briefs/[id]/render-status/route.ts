import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import {
  reconcileBriefRenderStatus,
  summarizeBriefRender,
} from "@/lib/services/video-service";

/**
 * GET：返回该 brief 的视频生成进度概要（用户安全字段 + debug 字段分离）。
 *      不会触碰 Provider，只读 DB —— UI 频繁刷新成本可控。
 *
 * POST：调用方主动调和 Provider 状态后再返回最新概要。
 *       调用代价：每次会向 Seedance 查 N 次（N = 在飞 job 数）。
 *       前端「刷新状态」按钮使用此端点。
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const summary = await summarizeBriefRender(id);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const summary = await reconcileBriefRenderStatus(id);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
