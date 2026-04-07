import { NextRequest, NextResponse } from "next/server";
import {
  getBatchWithProjects,
  executeBatch,
  pauseBatch,
  retryFailedInBatch,
} from "@/lib/services/batch-service";
import { handleApiError } from "@/lib/utils/api-error";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const batch = await getBatchWithProjects(id);
    return NextResponse.json(batch);
  } catch (error) {
    return handleApiError(error, "批次查询");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let action = "start";
  try {
    const body = await request.json();
    action = body.action || "start";
  } catch {
    // default action
  }

  try {
    switch (action) {
      case "start":
      case "resume": {
        executeBatch(id).catch((err) => {
          console.error(`[batch:${id}] 执行失败:`, err);
        });
        return NextResponse.json({ message: "批次已启动" });
      }
      case "pause": {
        const batch = await pauseBatch(id);
        return NextResponse.json(batch);
      }
      case "retry": {
        retryFailedInBatch(id).catch((err) => {
          console.error(`[batch:${id}] 重试失败:`, err);
        });
        return NextResponse.json({ message: "重试已启动" });
      }
      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return handleApiError(error, "批次操作");
  }
}
