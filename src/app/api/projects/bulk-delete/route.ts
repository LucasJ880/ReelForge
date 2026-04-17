import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import {
  bulkDeleteProjects,
  countExpiredProjects,
} from "@/lib/services/project-service";

export const maxDuration = 60;

/**
 * GET /api/projects/bulk-delete?days=30
 * 预览模式：返回符合过期条件的项目数量（不删除）
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30", 10);

  const count = await countExpiredProjects(days);

  return NextResponse.json({ expiredCount: count, days });
}

/**
 * POST /api/projects/bulk-delete
 * Body:
 * {
 *   ids?: string[],                 // 显式删除的项目 ID
 *   includeExpiredDays?: number,    // 可选，同时删掉 N 天前完成的项目
 * }
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const ids: unknown = body.ids;
  const includeExpiredDays: unknown = body.includeExpiredDays;

  const idList = Array.isArray(ids)
    ? ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : undefined;

  const days =
    typeof includeExpiredDays === "number" && includeExpiredDays > 0
      ? Math.min(365, Math.floor(includeExpiredDays))
      : undefined;

  if (!idList?.length && !days) {
    return NextResponse.json(
      { error: "必须提供 ids 或 includeExpiredDays 其中之一" },
      { status: 400 },
    );
  }

  try {
    const result = await bulkDeleteProjects({
      ids: idList,
      includeExpiredDays: days,
    });

    return NextResponse.json({
      success: true,
      ...result,
      message: `已删除 ${result.projectCount} 个项目，清理 ${result.blobsDeleted} 个媒体文件${
        result.blobsFailed > 0 ? `（${result.blobsFailed} 个失败已跳过）` : ""
      }`,
    });
  } catch (err) {
    console.error("[POST bulk-delete]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "批量删除失败" },
      { status: 500 },
    );
  }
}
