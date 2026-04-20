import { z } from "zod";

export const createDeliveryOrderSchema = z.object({
  title: z.string().min(2).max(120),
  productCategory: z.string().default("blanket"),
  targetCountry: z.string().min(2).max(12),
  targetLanguage: z.string().min(2).max(12),
  targetRegionVariant: z.string().optional(),
  productInput: z.record(z.unknown()),
  maxRounds: z.number().int().min(1).max(6).default(3),
});

export const createRoundSchema = z.object({
  sellingPointId: z.string().optional(),
  optimizationSlots: z.number().int().min(1).max(5).optional(),
  explorationSlots: z.number().int().min(0).max(5).optional(),
});

export const generateAnglesSchema = z.object({
  sellingPointId: z.string().optional(),
});

export const qaDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  comment: z.string().max(2000).optional(),
});

export const submitPostSchema = z.object({
  externalPostId: z.string().min(1),
  publishUrl: z.string().url().optional(),
  operatorNote: z.string().max(500).optional(),
});

export const metricsRowSchema = z.object({
  publishRecordId: z.string(),
  windowHours: z.union([z.literal(12), z.literal(24), z.literal(48)]),
  metrics: z.object({
    views: z.number().nonnegative().optional(),
    completion_rate: z.number().min(0).max(1).optional(),
    retention_3s: z.number().min(0).max(1).optional(),
    shares: z.number().nonnegative().optional(),
    saves: z.number().nonnegative().optional(),
    likes: z.number().nonnegative().optional(),
    comments: z.number().nonnegative().optional(),
  }),
});

export const createAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8).max(100),
  role: z.enum(["SUPER_ADMIN", "OPERATOR", "REVIEWER"]).default("OPERATOR"),
});

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
