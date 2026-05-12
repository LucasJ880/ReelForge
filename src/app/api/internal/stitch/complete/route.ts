import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finishStitchTask } from "@/lib/services/stitch-service";

const completeSchema = z.object({
  finalVideoId: z.string().min(1),
  stitchedVideoUrl: z.string().url().optional().nullable(),
  thumbnailUrl: z.string().url().optional().nullable(),
  error: z.string().optional().nullable(),
});

/**
 * 外部 stitch runner 完成（或失败）后的回调。
 *
 * 调用方：scripts/stitch-runner.ts
 * 鉴权：`Authorization: Bearer ${CRON_SECRET}`
 *
 * body:
 *   { finalVideoId: string, stitchedVideoUrl?: string, thumbnailUrl?: string, error?: string }
 *
 * 设计取舍：
 *   - 失败时不抛 5xx —— 因为 GH Action runner 出错时仍需要写库（status=FAILED）；
 *     如果这里 throw 让 runner 重试，会把 stitchAttempts 越涨越大。
 *   - 用 zod 校验入参，避免 stitchedVideoUrl=file:// 之类的脏数据再次溜进 DB。
 */
export async function POST(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  try {
    const result = await finishStitchTask(parsed.data);
    return NextResponse.json({ ok: result.ok, result });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: (err as Error).message,
    });
  }
}
