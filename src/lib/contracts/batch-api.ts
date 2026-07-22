import {
  BatchJobStatus,
  StoryboardApprovalPolicy,
  StoryboardFrameStatus,
  StoryboardRunStatus,
  VideoJobStatus,
} from "@prisma/client";
import { z } from "zod";
import {
  customerApiErrorSchema,
  customerApiErrorCodes,
  customerRecoveryActions,
} from "@/lib/contracts/customer-api";

const responseDateSchema = z.union([z.date(), z.string().datetime()]);

export const customerHttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "customer media URL must use http(s)");

export const customerBatchAssetAssignmentSchema = z
  .object({
    assets: z.array(
      z
        .object({
          id: z.string().min(1),
          url: customerHttpUrlSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const customerBatchJobErrorSchema = z
  .object({
    code: z.enum(customerApiErrorCodes),
    message: z.string().min(1),
    retryable: z.boolean(),
    action: z.enum(customerRecoveryActions),
  })
  .strict();

export const customerBatchJobSchema = z
  .object({
    id: z.string().min(1),
    batchIndex: z.number().int().nonnegative().nullable(),
    status: z.nativeEnum(VideoJobStatus),
    assignedAssets: customerBatchAssetAssignmentSchema.nullable(),
    outputVideoUrl: customerHttpUrlSchema.nullable(),
    outputThumbUrl: customerHttpUrlSchema.nullable(),
    lastProgress: z.number().min(0).max(100).nullable(),
    userSafeError: z.string().nullable(),
    retryCount: z.number().int().nonnegative(),
    storyboard: z
      .object({
        id: z.string().min(1),
        status: z.nativeEnum(StoryboardRunStatus),
        approvalPolicy: z.nativeEnum(StoryboardApprovalPolicy),
        frames: z.array(
          z
            .object({
              id: z.string().min(1),
              ordinal: z.number().int().nonnegative(),
              status: z.nativeEnum(StoryboardFrameStatus),
              imageUrl: customerHttpUrlSchema.nullable(),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    createdAt: responseDateSchema,
    submittedAt: responseDateSchema.nullable(),
    finishedAt: responseDateSchema.nullable(),
    error: customerBatchJobErrorSchema.nullable(),
  })
  .strict();

export const customerBatchStatusSchema = z
  .object({
    id: z.string().min(1),
    templateId: z.string().min(1),
    templateVersion: z.number().int().positive(),
    productName: z.string().nullable(),
    requestedCount: z.number().int().positive(),
    status: z.nativeEnum(BatchJobStatus),
    queuedCount: z.number().int().nonnegative(),
    pausedCount: z.number().int().nonnegative(),
    runningCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    cancelledCount: z.number().int().nonnegative(),
    statusReason: z.string().nullable(),
    finishedAt: responseDateSchema.nullable(),
    createdAt: responseDateSchema,
    updatedAt: responseDateSchema,
    template: z
      .object({
        id: z.string().min(1),
        version: z.number().int().positive(),
        name: z.string().min(1),
        nameZh: z.string().min(1),
        category: z.string().min(1),
        // Template previews may be same-origin public assets ("/...") or
        // absolute CDN URLs; both are valid wire values.
        coverImage: z.string().min(1).nullable(),
      })
      .strict(),
    videoJobs: z.array(customerBatchJobSchema),
  })
  .strict();

export const batchStatusResponseSchema = z
  .object({ batch: customerBatchStatusSchema })
  .strict();

export const batchCancelResponseSchema = z
  .object({
    cancelled: z.number().int().nonnegative(),
    batch: customerBatchStatusSchema,
  })
  .strict();

export const batchRetryAllResponseSchema = z
  .object({
    retried: z.number().int().nonnegative(),
    batch: customerBatchStatusSchema,
  })
  .strict();

export const batchRetryOneResponseSchema = z
  .object({
    retried: z.literal(1),
    batch: customerBatchStatusSchema,
  })
  .strict();

/** Batch creation is allowed to expose only aggregate video-quota metadata. */
export const batchQuotaErrorSchema = customerApiErrorSchema
  .extend({
    code: z.literal("QUOTA_EXCEEDED"),
    resource: z.literal("VIDEO_GENERATION"),
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    periodKey: z.string().min(1).max(40),
  })
  .strict();

export const batchValidationErrorSchema = customerApiErrorSchema
  .extend({
    code: z.literal("VALIDATION_FAILED"),
    issues: z
      .object({
        formErrors: z.array(z.string()),
        fieldErrors: z.record(z.array(z.string())),
      })
      .strict(),
  })
  .strict();

export const batchErrorResponseSchema = z.union([
  batchQuotaErrorSchema,
  batchValidationErrorSchema,
  customerApiErrorSchema,
]);
