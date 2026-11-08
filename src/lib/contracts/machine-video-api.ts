import { createHash } from "node:crypto";
import { z } from "zod";
import {
  customerApiErrorCodes,
  customerRecoveryActions,
  isCustomerRecoverySemanticallyValid,
} from "@/lib/contracts/customer-api";

/**
 * 机器视频任务契约。
 *
 * 创建任务 ≠ 开拍。POST 只落库并返回 taskId；故事板出图和视频供应商调用
 * 仍要账号本人在创作台走既有确认 / 派发。查询只读，不补派发、不重试。
 */

export const MACHINE_VIDEO_DURATIONS = [15, 30, 60] as const;

export const machineVideoTaskStatusSchema = z.enum([
  "awaiting_confirmation",
  "queued",
  "running",
  "failed",
  "processing_output",
  "deliverable",
  "cancelled",
]);

export const machineVideoTaskStageSchema = z.enum([
  "needs_storyboard",
  "storyboard_generating",
  "storyboard_ready",
  "storyboard_failed",
  "storyboard_approved",
  "storyboard_cancelled",
  "video_queued",
  "video_running",
  "video_failed",
  "video_ack_unknown",
  "output_pending",
  "deliverable",
  "taken_down",
]);

export const machineVideoCreateRequestSchema = z
  .object({
    prompt: z.string().trim().min(8).max(4000),
    voiceoverScript: z.string().trim().max(2000).nullish(),
    durationSec: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
    assetIds: z.array(z.string().trim().min(1).max(64)).max(9).default([]),
  })
  .strict();

export type MachineVideoCreateRequest = z.infer<typeof machineVideoCreateRequestSchema>;

const httpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "deliverable URL must use http(s)");

export const machineVideoFailureSchema = z
  .object({
    code: z.enum(customerApiErrorCodes),
    message: z.string().min(1),
    retryable: z.boolean(),
    action: z.enum(customerRecoveryActions),
  })
  .strict();

const machineVideoTaskShape = {
  ok: z.literal(true),
  taskId: z.string().min(1),
  briefId: z.string().min(1).nullable(),
  status: machineVideoTaskStatusSchema,
  stage: machineVideoTaskStageSchema,
  started: z.boolean(),
  deliverableUrl: httpUrlSchema.nullable(),
  failure: machineVideoFailureSchema.nullable(),
  confirmationPath: z.string().min(1),
};

function refineMachineVideoTask(
  value: {
    status: z.infer<typeof machineVideoTaskStatusSchema>;
    deliverableUrl: string | null;
    started: boolean;
    briefId: string | null;
    failure: { code: z.infer<typeof machineVideoFailureSchema>["code"]; retryable: boolean; action: z.infer<typeof machineVideoFailureSchema>["action"] } | null;
  },
  context: z.RefinementCtx,
) {
  if (value.status === "deliverable" && value.deliverableUrl == null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deliverableUrl"],
      message: "deliverable status requires a URL",
    });
  }
  if (value.status !== "deliverable" && value.deliverableUrl != null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deliverableUrl"],
      message: "only a deliverable task may expose a video URL",
    });
  }
  if (!value.started && value.briefId != null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["briefId"],
      message: "brief id exists only after filming starts",
    });
  }
  if (value.status === "deliverable" && value.failure != null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["failure"],
      message: "a deliverable task has no failure",
    });
  }
  if (
    value.failure &&
    !isCustomerRecoverySemanticallyValid({
      code: value.failure.code,
      retryable: value.failure.retryable,
      action: value.failure.action,
    })
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["failure"],
      message: "failure recovery semantics are invalid",
    });
  }
}

export const machineVideoTaskViewSchema = z
  .object(machineVideoTaskShape)
  .strict()
  .superRefine(refineMachineVideoTask);

export type MachineVideoTaskView = z.infer<typeof machineVideoTaskViewSchema>;

export const machineVideoCreateResponseSchema = z
  .object({ ...machineVideoTaskShape, replayed: z.boolean() })
  .strict()
  .superRefine(refineMachineVideoTask);

export function machineVideoConfirmationPath(taskId: string): string {
  return `/app/create?machineTask=${encodeURIComponent(taskId)}`;
}

export function hashMachineVideoRequest(input: {
  prompt: string;
  voiceoverScript?: string | null;
  durationSec: number;
  aspectRatio: string;
  assetIds: readonly string[];
}): string {
  const canonical = {
    prompt: input.prompt.trim(),
    voiceoverScript: input.voiceoverScript?.trim() || null,
    durationSec: input.durationSec,
    aspectRatio: input.aspectRatio,
    assetIds: [...new Set(input.assetIds)].sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
