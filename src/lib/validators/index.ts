import { z } from "zod";

export const updateBriefSchema = z.object({
  durationSec: z.number().int().min(10).max(60).optional(),
  aspectRatio: z.string().optional(),
  tone: z.string().optional(),
  onCameraMode: z
    .enum([
      "NONE",
      "SELF_RAW",
      "SELF_VOICE_REPLACED",
      "SELF_SUBTITLED",
      "UGC_AVATAR",
      "PRODUCT_ONLY",
    ])
    .optional(),
  referenceImageUrls: z.array(z.string().url()).max(5).optional(),
});
