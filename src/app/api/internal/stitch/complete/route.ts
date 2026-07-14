import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { machineAuthFailure } from "@/lib/machine-auth";
import {
  finishStitchTask,
  STALE_STITCH_ATTEMPT_CODE,
} from "@/lib/services/stitch-service";

const completeSchema = z.object({
  finalVideoId: z.string().min(1),
  // Rolling-deploy compatibility: a runner that claimed before the token
  // migration has no credential to send. The service only accepts omission
  // while the row itself still has a null token; every new claim writes one.
  attemptToken: z.string().min(1).optional(),
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
 *   { finalVideoId: string, attemptToken?: string, stitchedVideoUrl?: string, thumbnailUrl?: string, error?: string }
 *
 * 设计取舍：
 *   - 失败时不抛 5xx —— 因为 GH Action runner 出错时仍需要写库（status=FAILED）；
 *     如果这里 throw 让 runner 重试，会把 stitchAttempts 越涨越大。
 *   - 用 zod 校验入参，避免 stitchedVideoUrl=file:// 之类的脏数据再次溜进 DB。
 */
export async function POST(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;

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
    if (result.conflict) {
      return NextResponse.json(
        {
          ok: false,
          code: STALE_STITCH_ATTEMPT_CODE,
          error: "stitch attempt is no longer active",
          result,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: result.ok, result });
  } catch (err) {
    console.error("[stitch:complete] callback failed", {
      finalVideoId: parsed.data.finalVideoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "stitch completion could not be recorded",
      },
      { status: 500 },
    );
  }
}
