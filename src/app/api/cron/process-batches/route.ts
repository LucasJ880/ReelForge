import { NextRequest, NextResponse } from "next/server";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import { processBatchTick, selectCronBatchIds } from "@/lib/services/batch-service";
import {
  CRON_FRAME_QA_BUDGET,
  frameQaBudgetUsage,
  runWithFrameQaBudget,
} from "@/lib/services/frame-qa-gate";

/// D2：批次 tick 里 reconcile 到「供应商已完成」的段在这里跑帧质检（有预算上限），
/// 质检最坏 45s/次，函数时长放到 300s。
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
  return runWithFrameQaBudget(
    { label: "cron:process-batches", ...CRON_FRAME_QA_BUDGET },
    processBatches,
  );
}

async function processBatches() {
  const heartbeat = startSchedulerHeartbeat("process-batches");
  try {
    /// 选批次在 batch-service：有段等着质检的批次优先，不会被前端轮询饿死（runtime LENS-5）
    const batches = (await selectCronBatchIds()).map((id) => ({ id }));
    const results = [];
    for (const batch of batches) {
      try {
        const updated = await processBatchTick(batch.id);
        results.push({ id: batch.id, status: updated.status, ok: true });
      } catch (error) {
        results.push({
          id: batch.id,
          ok: false,
          error: (error as Error).message,
        });
      }
    }
    const failed = results.filter((result) => !result.ok).length;
    const heartbeatEvent = heartbeat.finish(failed > 0 ? "degraded" : "ok", {
      selected: batches.length,
      processed: results.length,
      failed,
    });
    return NextResponse.json({
      processed: results.length,
      results,
      frameQa: frameQaBudgetUsage(),
      heartbeat: heartbeatEvent,
    });
  } catch (error) {
    const heartbeatEvent = heartbeat.finish("error", {
      selected: 0,
      processed: 0,
      failed: 1,
    });
    return NextResponse.json(
      {
        error: (error as Error).message,
        heartbeat: heartbeatEvent,
      },
      { status: 500 },
    );
  }
}

export const POST = GET;
