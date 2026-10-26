import { z } from "zod";

export const stitchDispatchSuccessOutcomes = [
  "not_external",
  "lock_busy",
  "no_pending",
  "already_active",
  "dispatched",
  /// inprocess（C3 生产默认）：本次函数调用认领并合成了 ≥1 条
  "stitched_inprocess",
  /// inprocess：有就绪任务，但都已被并发调用认领 / 本次预算放不下
  "inprocess_idle",
] as const;

/** inprocess 一次调用的计数（只有 stitched_inprocess / inprocess_idle 带） */
export const stitchDispatchInprocessSchema = z
  .object({
    claimed: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    requeued: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
    stoppedBecause: z.enum(["no_pending", "drained", "budget", "max_tasks", "concurrency"]),
    elapsedMs: z.number().int().nonnegative(),
  })
  .strict();

const INPROCESS_OUTCOMES = new Set<string>(["stitched_inprocess", "inprocess_idle"]);

export const stitchDispatchFailureOutcomes = [
  "config_missing",
  "github_error",
  "internal_error",
] as const;

const stitchDispatchOutcomeSchema = z.enum([
  ...stitchDispatchSuccessOutcomes,
  ...stitchDispatchFailureOutcomes,
]);

export const stitchDispatchHeartbeatSchema = z
  .object({
    event: z.literal("scheduler_heartbeat"),
    scheduler: z.literal("stitch-dispatch"),
    phase: z.literal("finished"),
    runId: z.string().min(1),
    timestamp: z.string().datetime(),
    startedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    outcome: z.enum(["ok", "skipped", "error"]),
    details: z
      .object({
        outcome: stitchDispatchOutcomeSchema,
        pending: z.number().int().nonnegative(),
        claimed: z.number().int().nonnegative().optional(),
        succeeded: z.number().int().nonnegative().optional(),
        failed: z.number().int().nonnegative().optional(),
        requeued: z.number().int().nonnegative().optional(),
        lost: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const stitchDispatchSuccessSchema = z
  .object({
    ok: z.literal(true),
    dispatched: z.boolean(),
    outcome: z.enum(stitchDispatchSuccessOutcomes),
    pending: z.number().int().nonnegative(),
    inprocess: stitchDispatchInprocessSchema.optional(),
    heartbeat: stitchDispatchHeartbeatSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.dispatched !== (payload.outcome === "dispatched")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dispatched"],
        message: "dispatched must match outcome",
      });
    }
    if (Boolean(payload.inprocess) !== INPROCESS_OUTCOMES.has(payload.outcome)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inprocess"],
        message: "inprocess counters are present exactly for inprocess outcomes",
      });
    }
    const expectedHeartbeatOutcome =
      payload.outcome === "dispatched" || payload.outcome === "stitched_inprocess"
        ? "ok"
        : "skipped";
    if (payload.heartbeat.outcome !== expectedHeartbeatOutcome) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heartbeat", "outcome"],
        message: "heartbeat outcome must match dispatch outcome",
      });
    }
    if (
      payload.heartbeat.details.outcome !== payload.outcome ||
      payload.heartbeat.details.pending !== payload.pending
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heartbeat", "details"],
        message: "heartbeat details must match response",
      });
    }
  });

const stitchDispatchConfigFailureSchema = z
  .object({
    ok: z.literal(false),
    code: z.literal("STITCH_DISPATCH_CONFIG_MISSING"),
    error: z.literal("external stitch dispatcher unavailable"),
    retryable: z.literal(false),
    action: z.literal("contact_support"),
    outcome: z.literal("config_missing"),
    pending: z.number().int().positive(),
    heartbeat: stitchDispatchHeartbeatSchema,
  })
  .strict();

const stitchDispatchUpstreamFailureSchema = z
  .object({
    ok: z.literal(false),
    code: z.literal("STITCH_DISPATCH_UPSTREAM_ERROR"),
    error: z.literal("external stitch dispatcher failed"),
    retryable: z.literal(true),
    action: z.literal("wait"),
    outcome: z.literal("github_error"),
    pending: z.number().int().positive(),
    heartbeat: stitchDispatchHeartbeatSchema,
  })
  .strict();

const stitchDispatchInternalFailureSchema = z
  .object({
    ok: z.literal(false),
    code: z.literal("STITCH_DISPATCH_INTERNAL_ERROR"),
    error: z.literal("external stitch dispatcher failed"),
    retryable: z.literal(true),
    action: z.literal("wait"),
    outcome: z.literal("internal_error"),
    pending: z.literal(0),
    heartbeat: stitchDispatchHeartbeatSchema,
  })
  .strict();

export const stitchDispatchFailureSchema = z
  .discriminatedUnion("code", [
    stitchDispatchConfigFailureSchema,
    stitchDispatchUpstreamFailureSchema,
    stitchDispatchInternalFailureSchema,
  ])
  .superRefine((payload, context) => {
    if (
      payload.heartbeat.outcome !== "error" ||
      payload.heartbeat.details.outcome !== payload.outcome ||
      payload.heartbeat.details.pending !== payload.pending
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heartbeat"],
        message: "failure heartbeat must match response",
      });
    }
  });

export const stitchDispatchResponseSchema = z.union([
  stitchDispatchSuccessSchema,
  stitchDispatchFailureSchema,
]);

export const stitchDispatchAuthFailureSchema = z.union([
  z.object({ error: z.literal("unauthorized") }).strict(),
  z.object({ error: z.literal("service unavailable") }).strict(),
]);

export function stitchDispatchSuccess(
  payload: z.input<typeof stitchDispatchSuccessSchema>,
) {
  return stitchDispatchSuccessSchema.parse(payload);
}

export function stitchDispatchFailure(
  payload: z.input<typeof stitchDispatchFailureSchema>,
) {
  return stitchDispatchFailureSchema.parse(payload);
}
