import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireOperator } from "@/lib/api-auth";

/**
 * 简易 Vercel Blob 上传：前端以 POST multipart/form-data 上传单文件。
 * 用于产品参考图、自定义参考图等。
 */
export async function POST(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN 未配置" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  const prefix = (form.get("prefix") as string | null) ?? "uploads";
  const filename = `${prefix}/${Date.now()}-${file.name}`;

  const blob = await put(filename, file, {
    access: "public",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return NextResponse.json({ url: blob.url, pathname: blob.pathname });
}
