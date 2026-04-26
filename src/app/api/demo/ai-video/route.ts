import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { put } from "@vercel/blob";
import { analyzeDemoReferenceVideo } from "@/lib/services/demo-video-analysis-service";
import {
  getHeyGenProofStatus,
  submitHeyGenProof,
} from "@/lib/providers/digital-human";

export const maxDuration = 60;
export const runtime = "nodejs";

const demoInputSchema = z.object({
  action: z.literal("analyze").optional(),
  tiktokUrl: z.string().url().max(500),
  clientIndustry: z.string().min(1).max(120),
  clientOffer: z.string().min(1).max(220),
  targetAudience: z.string().min(1).max(160),
  tone: z.enum(["premium", "friendly", "expert", "bold"]).default("premium"),
});

const heyGenProofSchema = z.object({
  action: z.literal("render-proof"),
  title: z.string().min(1).max(120),
  script: z.string().min(1).max(1200),
  avatarId: z.string().max(120).optional(),
  voiceId: z.string().max(120).optional(),
  talkingPhotoUrl: z.string().url().max(2000).optional(),
});

const heyGenStatusSchema = z.object({
  action: z.literal("render-status"),
  videoId: z.string().min(8).max(160),
});

const ALLOWED_UPLOAD_KINDS = {
  portrait: ["image/jpeg", "image/jpg", "image/png"],
  broll: ["video/mp4", "video/quicktime"],
} as const;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return await handleMultipartUpload(req);
    }

    const body = await req.json();
    if (body?.action === "render-proof") {
      const input = heyGenProofSchema.parse(body);
      const result = await submitHeyGenProof(input);
      return NextResponse.json(result);
    }

    if (body?.action === "render-status") {
      const input = heyGenStatusSchema.parse(body);
      const result = await getHeyGenProofStatus(input.videoId);
      return NextResponse.json(result);
    }

    const input = demoInputSchema.parse(body);
    const result = await analyzeDemoReferenceVideo(input);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message || "输入格式不正确"
        : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function handleMultipartUpload(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "服务端未配置 BLOB_READ_WRITE_TOKEN" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const kindRaw = String(form.get("kind") || "").toLowerCase();
  const kind =
    kindRaw === "portrait" || kindRaw === "broll" ? kindRaw : null;
  if (!kind) {
    return NextResponse.json(
      { error: "kind 必须是 portrait 或 broll" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "缺少 file 字段" },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "文件为空" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 限制` },
      { status: 400 },
    );
  }

  const mime = (file.type || "").toLowerCase();
  const allowedMimes: readonly string[] = ALLOWED_UPLOAD_KINDS[kind];
  if (!allowedMimes.includes(mime)) {
    return NextResponse.json(
      {
        error: `${kind} 仅支持 ${allowedMimes.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const ext = pickExt(mime);
  const random = crypto.randomUUID();
  const key = `demo-uploads/${kind}/${Date.now()}-${random}.${ext}`;

  const blob = await put(key, file, {
    access: "public",
    contentType: mime,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: false,
  });

  return NextResponse.json({
    kind,
    url: blob.url,
    pathname: blob.pathname,
    size: file.size,
    mime,
    name: file.name,
  });
}

function pickExt(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/quicktime") return "mov";
  return "bin";
}
