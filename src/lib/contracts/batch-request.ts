import { z } from "zod";
import {
  MAX_BATCH_IMAGE_COUNT,
  MAX_BATCH_VIDEO_COUNT,
} from "@/lib/contracts/batch-limits";

export const batchIdempotencyKeySchema = z.string().trim().min(1).max(200);

export const batchCreateRequestSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.number().int().min(1),
  images: z
    .array(
      z.object({
        id: z.string().min(1).max(300),
        url: z.string().url().refine((url) => /^https?:\/\//i.test(url)),
      }),
    )
    .min(1)
    .max(MAX_BATCH_IMAGE_COUNT),
  requestedCount: z.number().int().min(1).max(MAX_BATCH_VIDEO_COUNT),
  productName: z.string().trim().max(200).optional(),
  idempotencyKey: batchIdempotencyKeySchema.optional(),
  videoRouteId: z
    .enum(["byteplus_international", "volcengine_cn_legacy", "buddy"])
    .optional(),
});
