import { BatchJobStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { machineAuthFailure } from "@/lib/machine-auth";
import { startSchedulerHeartbeat } from "@/lib/scheduler-heartbeat";
import { processBatchTick } from "@/lib/services/batch-service";

export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
  const heartbeat = startSchedulerHeartbeat("process-batches");
  try {
    const batches = await db.batchJob.findMany({
      where: {
        status: { in: [BatchJobStatus.RUNNING, BatchJobStatus.PAUSED] },
      },
      orderBy: { updatedAt: "asc" },
      select: { id: true },
      take: 20,
    });
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
