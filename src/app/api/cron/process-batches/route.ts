import { BatchJobStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { machineAuthFailure } from "@/lib/machine-auth";
import { processBatchTick } from "@/lib/services/batch-service";

export async function GET(req: NextRequest) {
  const authFailure = machineAuthFailure(req);
  if (authFailure) return authFailure;
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
  return NextResponse.json({ processed: results.length, results });
}

export const POST = GET;
