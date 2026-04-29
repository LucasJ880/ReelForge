import { z } from "zod";

export const createDeliveryOrderSchema = z.object({
  title: z.string().min(2).max(120),
  productCategory: z.string().default("pet_products"),
  targetPlatform: z.string().default("tiktok"),
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

export const registerRawAssetSchema = z.object({
  type: z.enum(["VIDEO", "IMAGE", "AUDIO"]).default("VIDEO"),
  name: z.string().min(1).max(180),
  url: z.string().url(),
  mimeType: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().max(180).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const preprocessRawAssetSchema = z.object({
  silenceThresholdDb: z.number().min(-80).max(0).default(-28),
  motionThreshold: z.number().min(0).max(1).default(0.02),
  marginBeforeMs: z.number().int().min(0).max(5000).default(300),
  marginAfterMs: z.number().int().min(0).max(5000).default(500),
  targetShotMs: z.number().int().min(1500).max(12000).default(4500),
  minShotMs: z.number().int().min(500).max(5000).default(1200),
  transcript: z.string().max(10000).optional(),
  visualSummary: z.string().max(2000).optional(),
});

export const generateAdEditPlansSchema = z.object({
  count: z.number().int().min(1).max(8).default(5),
  retryThreshold: z.number().min(0).max(1).default(0.65),
});

export const renderAdEditPlanSchema = z.object({
  planId: z.string().optional(),
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
