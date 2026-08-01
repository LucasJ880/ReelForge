import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import {
  performanceIngestRequestSchema,
  performanceIngestResponseSchema,
} from "@/lib/contracts/performance-api";
import { ingestPerformanceSamples } from "@/lib/services/performance-ingest-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/performance` —— 青砚回灌渠道指标（PRD §4 / M2 / R2）。
 *
 * 与 `/api/videos` 同一套机器鉴权，同样没有会话回退：
 * 这是系统间接口，不存在「运营在本地手点一下」的用法。
 *
 * 回流方**不能指定配方** —— 配方是我们生成时确定的事实，从我方 subject 上读。
 * 允许外部覆盖它等于给赛马开一个能被写脏的口子。
 */
export async function POST(req: NextRequest) {
  const machineFailure = machineAuthFailure(req);
  if (machineFailure) return machineFailure;

  const parsed = performanceIngestRequestSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await ingestPerformanceSamples(parsed.data.samples);
  return NextResponse.json(performanceIngestResponseSchema.parse(result), {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
