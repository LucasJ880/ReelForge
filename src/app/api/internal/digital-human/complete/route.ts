import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { completeDigitalHumanAdJob } from "@/lib/services/digital-human-service";
import {
  DIGITAL_HUMAN_SEALED_RESPONSE,
  isDigitalHumanFeatureEnabled,
} from "@/lib/features/digital-human";

const completeSchema = z.object({
  jobId: z.string().min(1),
  outputVideoUrl: z.string().url().optional().nullable(),
  outputThumbnailUrl: z.string().url().optional().nullable(),
  storyboard: z.unknown().optional(),
  error: z.string().optional().nullable(),
});

/**
 * 外部数字人 runner 出片（或失败）后的回调。
 *
 * 调用方：scripts/digital-human-runner.ts
 * 鉴权：Authorization: Bearer ${CRON_SECRET}
 *
 * 设计同 stitch/complete：失败不抛 5xx（让 runner 退出而非重试导致 attempts 失控）。
 */
export async function POST(req: NextRequest) {
  if (!isDigitalHumanFeatureEnabled()) {
    return NextResponse.json(DIGITAL_HUMAN_SEALED_RESPONSE, { status: 404 });
  }
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
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  try {
    const result = await completeDigitalHumanAdJob(parsed.data);
    return NextResponse.json({ ok: result.ok, status: result.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
