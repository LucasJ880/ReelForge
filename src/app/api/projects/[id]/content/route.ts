import { NextRequest, NextResponse } from "next/server";
import { updateContentPlan } from "@/lib/services/content-service";

const ALLOWED_FIELDS = new Set(["script", "caption", "hashtags", "videoPrompt"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const data: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(key)) {
      data[key] = body[key];
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效字段" }, { status: 400 });
  }

  try {
    const plan = await updateContentPlan(id, data);
    return NextResponse.json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新失败";
    if (message === "项目不存在" || message === "尚未生成内容方案") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
