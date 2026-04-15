import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "缺少文件" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "仅支持 JPEG、PNG、WebP 格式" },
        { status: 400 },
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "文件大小不能超过 10MB" },
        { status: 400 },
      );
    }

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const blob = await put(filename, file, { access: "public", addRandomSuffix: true });

    return NextResponse.json({ url: blob.url, filename: blob.pathname });
  } catch (error) {
    console.error("[upload] Error:", error);

    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("private store") || errMsg.includes("public access")) {
      return NextResponse.json(
        { error: "Blob Store 需要设置为 public access。请在 Vercel Dashboard → Storage → 你的 Blob Store → Settings 中切换为 Public。", detail: errMsg },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "上传失败", detail: errMsg },
      { status: 500 },
    );
  }
}
