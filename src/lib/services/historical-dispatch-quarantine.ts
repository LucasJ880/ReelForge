import { BatchJobStatus, VideoJobStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * GATE 0 decision cutoff. This is deliberately conservative: it was captured
 * when execution resumed, so it cannot accidentally omit an older queued job.
 */
export const HISTORICAL_DISPATCH_CUTOFF = new Date(
  "2026-07-13T14:35:00.000Z",
);

export const QUARANTINE_RELEASED = "RELEASED" as const;
export const QUARANTINE_EXPIRED = "EXPIRED" as const;
export type DispatchQuarantineDecision =
  | typeof QUARANTINE_RELEASED
  | typeof QUARANTINE_EXPIRED;

export interface DispatchQuarantineRecord {
  createdAt: Date;
  dispatchQuarantineDecision?: string | null;
}

export function isRealVideoDispatchMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if ((env.VIDEO_PROVIDER ?? "byteplus").trim().toLowerCase() === "mock") {
    return false;
  }
  return ["0", "false", "no", "off"].includes(
    (env.VIDEO_ENGINE_MOCK ?? "").trim().toLowerCase(),
  );
}

export function isHistoricalDispatchQuarantined(
  record: DispatchQuarantineRecord,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (record.dispatchQuarantineDecision === QUARANTINE_EXPIRED) return true;
  if (record.dispatchQuarantineDecision === QUARANTINE_RELEASED) return false;
  return (
    isRealVideoDispatchMode(env) &&
    record.createdAt.getTime() <= HISTORICAL_DISPATCH_CUTOFF.getTime()
  );
}

export async function callProviderWithHistoricalGuard<T>(args: {
  record: DispatchQuarantineRecord;
  call: () => Promise<T>;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Promise<{ called: false } | { called: true; value: T }> {
  if (isHistoricalDispatchQuarantined(args.record, args.env)) {
    return { called: false };
  }
  return { called: true, value: await args.call() };
}

export interface QuarantineCasResult {
  outcome: "applied" | "cas_conflict" | "not_eligible";
  batchUpdated: number;
  videoJobsUpdated: number;
}

/**
 * Human-only operation. The update is compare-and-swap on id + RUNNING +
 * cutoff + null decision, and child QUEUED jobs use the same guard.
 * No provider call is made here.
 */
export async function decideHistoricalBatchQuarantine(args: {
  batchId: string;
  decision: DispatchQuarantineDecision;
  actor: string;
  expectedUpdatedAt: Date;
}): Promise<QuarantineCasResult> {
  if (!args.actor.trim()) throw new Error("actor 不能为空");
  const decidedAt = new Date();

  return db.$transaction(async (tx) => {
    const eligible = await tx.batchJob.findFirst({
      where: {
        id: args.batchId,
        status: BatchJobStatus.RUNNING,
        createdAt: { lte: HISTORICAL_DISPATCH_CUTOFF },
        dispatchQuarantineDecision: null,
      },
      select: { id: true, updatedAt: true },
    });
    if (!eligible) {
      return {
        outcome: "not_eligible" as const,
        batchUpdated: 0,
        videoJobsUpdated: 0,
      };
    }
    if (eligible.updatedAt.getTime() !== args.expectedUpdatedAt.getTime()) {
      return {
        outcome: "cas_conflict" as const,
        batchUpdated: 0,
        videoJobsUpdated: 0,
      };
    }

    const batch = await tx.batchJob.updateMany({
      where: {
        id: args.batchId,
        status: BatchJobStatus.RUNNING,
        createdAt: { lte: HISTORICAL_DISPATCH_CUTOFF },
        updatedAt: args.expectedUpdatedAt,
        dispatchQuarantineDecision: null,
      },
      data: {
        dispatchQuarantineDecision: args.decision,
        dispatchQuarantineAt: decidedAt,
        dispatchQuarantineBy: args.actor.trim(),
        statusReason:
          args.decision === QUARANTINE_EXPIRED
            ? "[historical_quarantine:expired] 人工标记为过期，不再派发"
            : "[historical_quarantine:released] 人工显式放行",
      },
    });
    if (batch.count !== 1) {
      return {
        outcome: "cas_conflict" as const,
        batchUpdated: 0,
        videoJobsUpdated: 0,
      };
    }

    const jobs = await tx.videoJob.updateMany({
      where: {
        batchJobId: args.batchId,
        status: VideoJobStatus.QUEUED,
        createdAt: { lte: HISTORICAL_DISPATCH_CUTOFF },
        dispatchQuarantineDecision: null,
      },
      data: {
        dispatchQuarantineDecision: args.decision,
        dispatchQuarantineAt: decidedAt,
        dispatchQuarantineBy: args.actor.trim(),
      },
    });
    return {
      outcome: "applied" as const,
      batchUpdated: batch.count,
      videoJobsUpdated: jobs.count,
    };
  });
}
