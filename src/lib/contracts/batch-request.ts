import { z } from "zod";
import {
  MAX_BATCH_IMAGE_COUNT,
  MAX_BATCH_VIDEO_COUNT,
} from "@/lib/contracts/batch-limits";
import { batchPostProductionSchema } from "@/lib/schemas/unified-input";

export const batchIdempotencyKeySchema = z.string().trim().min(1).max(200);

export const batchCreateRequestSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.number().int().min(1),
  assetIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_IMAGE_COUNT),
  requestedCount: z.number().int().min(1).max(MAX_BATCH_VIDEO_COUNT),
  productName: z.string().trim().max(200).optional(),
  idempotencyKey: batchIdempotencyKeySchema.optional(),
  videoRouteId: z
    .enum(["byteplus_international", "volcengine_cn_legacy", "buddy"])
    .optional(),
  /// 合作方线路的套餐选择(0803 多套餐);必须在实时审计清单内,省略 = 默认套餐。
  videoPlanId: z.string().trim().min(1).max(200).optional(),
  /// 批次级后期（口播 / BGM / 字幕），整批共用；省略 = 输出干净视频。
  postProduction: batchPostProductionSchema.optional(),
}).strict();
