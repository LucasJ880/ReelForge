import { NextRequest, NextResponse } from "next/server";
import { publishToTikTok } from "@/lib/services/publish-service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await publishToTikTok(id);
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发布失败";

    if (message === "项目不存在") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (
      message.startsWith("当前状态") ||
      message === "没有可用的视频" ||
      message === "缺少内容方案"
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("[publish] 发布失败:", error);
    return NextResponse.json(
      { error: "发布失败", detail: message },
      { status: 500 }
    );
  }
}
