import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { claimDigitalHumanAdJob } from "@/lib/services/digital-human-service";
import {
  DIGITAL_HUMAN_SEALED_RESPONSE,
  isDigitalHumanFeatureEnabled,
} from "@/lib/features/digital-human";

/**
 * 外部数字人 runner（GH Action）领取一条就绪任务。
 *
 * 调用方：.github/workflows/digital-human-render.yml → scripts/digital-human-runner.ts
 * 鉴权：Authorization: Bearer ${CRON_SECRET}（与 cron/stitch 复用同一密钥）
 *
 * 返回：{ task: ClaimedDigitalHumanAdJob } 或 { task: null }（无任务时 runner 直接退出）
 */
export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
  if (!isDigitalHumanFeatureEnabled()) {
    return NextResponse.json(DIGITAL_HUMAN_SEALED_RESPONSE, { status: 404 });
  }
  try {
    const task = await claimDigitalHumanAdJob();
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json(
      { task: null, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const POST = GET;
