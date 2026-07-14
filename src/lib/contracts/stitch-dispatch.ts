import { z } from "zod";

export const stitchDispatchSuccessOutcomes = [
  "not_external",
  "lock_busy",
  "no_pending",
  "already_active",
  "dispatched",
] as const;

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
    const expectedHeartbeatOutcome =
      payload.outcome === "dispatched" ? "ok" : "skipped";
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
