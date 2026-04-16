import { NextRequest, NextResponse } from "next/server";
import {
  listKeywords,
  createKeyword,
  deleteKeyword,
} from "@/lib/services/trend-service";
import { handleApiError } from "@/lib/utils/api-error";
import { requireAdmin } from "@/lib/api-auth";

export async function GET() {
  try {
    const keywords = await listKeywords();
    return NextResponse.json(keywords);
  } catch (error) {
    return handleApiError(error, "获取关键词");
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const { keyword } = body;

    if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
      return NextResponse.json({ error: "请输入关键词" }, { status: 400 });
    }

    const created = await createKeyword(keyword.trim());
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleApiError(error, "创建关键词");
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "缺少关键词 ID" }, { status: 400 });
    }

    await deleteKeyword(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "删除关键词");
  }
}
