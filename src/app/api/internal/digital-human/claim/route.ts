import { NextRequest, NextResponse } from "next/server";
import { claimDigitalHumanAdJob } from "@/lib/services/digital-human-service";

/**
 * 外部数字人 runner（GH Action）领取一条就绪任务。
 *
 * 调用方：.github/workflows/digital-human-render.yml → scripts/digital-human-runner.ts
 * 鉴权：Authorization: Bearer ${CRON_SECRET}（与 cron/stitch 复用同一密钥）
 *
 * 返回：{ task: ClaimedDigitalHumanAdJob } 或 { task: null }（无任务时 runner 直接退出）
 */
export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
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
