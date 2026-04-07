import { NextRequest, NextResponse } from "next/server";
import { generateContentPlan } from "@/lib/services/content-service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const contentPlan = await generateContentPlan(id);
    return NextResponse.json({ contentPlan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "内容生成失败";

    if (message === "项目不存在") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.startsWith("当前状态")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("[generate] 内容生成失败:", error);
    return NextResponse.json(
      { error: "内容生成失败，请重试", detail: message },
      { status: 500 }
    );
  }
}
