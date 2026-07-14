import { randomUUID } from "node:crypto";

export type SchedulerHeartbeatOutcome =
  | "ok"
  | "degraded"
  | "skipped"
  | "error";

export type SchedulerHeartbeatDetails = Record<
  string,
  string | number | boolean | null
>;

export interface SchedulerHeartbeatEvent {
  event: "scheduler_heartbeat";
  scheduler: string;
  phase: "started" | "finished";
  runId: string;
  timestamp: string;
  startedAt: string;
  durationMs?: number;
  outcome?: SchedulerHeartbeatOutcome;
  details?: SchedulerHeartbeatDetails;
}

/**
 * Emits one structured start event and exactly one structured finish event.
 * Only callers' safe counters/classifications belong in details; never pass
 * credentials, request headers, provider payloads, or raw error messages.
 */
export function startSchedulerHeartbeat(
  scheduler: string,
  options: {
    now?: () => Date;
    runId?: string;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const started = now();
  const runId = options.runId ?? randomUUID();
  const startedEvent: SchedulerHeartbeatEvent = {
    event: "scheduler_heartbeat",
    scheduler,
    phase: "started",
    runId,
    timestamp: started.toISOString(),
    startedAt: started.toISOString(),
  };
  console.log(JSON.stringify(startedEvent));

  let finishedEvent: SchedulerHeartbeatEvent | null = null;
  return {
    runId,
    finish(
      outcome: SchedulerHeartbeatOutcome,
      details: SchedulerHeartbeatDetails = {},
    ): SchedulerHeartbeatEvent {
      if (finishedEvent) return finishedEvent;
      const completed = now();
      finishedEvent = {
        event: "scheduler_heartbeat",
        scheduler,
        phase: "finished",
        runId,
        timestamp: completed.toISOString(),
        startedAt: started.toISOString(),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        outcome,
        details,
      };
      console.log(JSON.stringify(finishedEvent));
      return finishedEvent;
    },
  };
}
