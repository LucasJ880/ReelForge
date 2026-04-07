import { NextRequest, NextResponse } from "next/server";
import { submitVideoJob, checkVideoStatus } from "@/lib/services/video-service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const videoJob = await submitVideoJob(id);
    return NextResponse.json({ videoJob });
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频生成失败";

    if (message === "项目不存在") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.startsWith("当前状态") || message === "请先生成内容方案") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("[video] 视频生成提交失败:", error);
    return NextResponse.json(
      { error: "视频生成失败", detail: message },
      { status: 500 }
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await checkVideoStatus(id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
