import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import {
  createStoryboardRun,
  StoryboardRequestError,
} from "@/lib/video-generation/storyboard-service";

const createSchema = z.object({
  prompt: z.string().trim().min(8).max(4000),
  durationSec: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  sourceAssetIds: z.array(z.string().min(1).max(200)).max(8).default([]),
  approvalPolicy: z.enum(["MANUAL", "AUTO"]).default("MANUAL"),
  purpose: z.string().trim().min(1).max(200).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;
  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json(
      { ok: false, code: "IDEMPOTENCY_KEY_REQUIRED", error: "缺少有效的提交标识。" },
      { status: 400 },
    );
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_FAILED", error: "故事板参数不完整或格式不正确。" },
      { status: 400 },
    );
  }
  try {
    const run = await createStoryboardRun({
      userId: guard.session.user.id,
      idempotencyKey,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, run }, { status: 201 });
  } catch (error) {
    if (error instanceof StoryboardRequestError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }
    console.error("[storyboards:POST]", error);
    return NextResponse.json(
      { ok: false, code: "INTERNAL_ERROR", error: "暂时无法创建故事板。" },
      { status: 500 },
    );
  }
}
