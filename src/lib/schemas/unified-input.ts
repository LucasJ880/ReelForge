/**
 * Phase 5 — Zod runtime validation for unified video-generation pipeline.
 *
 * 与 src/types/video-generation.ts 的 TS 类型一一对应；用于：
 *  - API 路由的 body validation
 *  - DB JSON 字段（VideoBrief.videoGenerationPlan）的反序列化校验
 *
 * 注意：DirectorPlan 自己的 zod 还在 src/lib/schemas/director-plan.ts 不动；
 * 这里只覆盖 unified 这一层（外层 plan + request + asset）。
 */

import { z } from "zod";

export const SUPPORTED_DURATIONS = [15, 30, 60] as const;
export const supportedDurationSchema = z.union([
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);

export const userTypeSchema = z.enum(["business", "personal"]);

export const generationModeSchema = z.enum([
  "text_to_video",
  "image_to_video",
  "mixed_assets_to_video",
  "text_to_video_ad",
  "image_to_video_ad",
  "mixed_assets_to_video_ad",
]);

export const videoGoalSchema = z.enum([
  "product_ad",
  "product_showcase",
  "ugc_style_ad",
  "lifestyle_ad",
  "promo_ad",
  "personal_creative",
  "personal_lifestyle",
  "personal_clip",
]);

export const targetPlatformSchema = z.enum([
  "tiktok",
  "instagram_reels",
  "youtube_shorts",
  "generic_vertical",
]);

export const aspectRatioSchema = z.enum(["9:16", "16:9", "1:1"]);

export const brandEndingModeSchema = z.enum([
  "auto_end_card",
  "uploaded_clip",
  "none",
]);

export const assetRoleSchema = z.enum([
  "product_image",
  "reference_image",
  "logo",
  "intro_clip",
  "outro_clip",
  "ad_clip",
  "store_clip",
  "product_demo_clip",
  "logo_animation",
  "existing_commercial",
  "unknown",
]);

export const uploadedAssetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["VIDEO", "IMAGE", "AUDIO"]),
  inferredRole: assetRoleSchema,
  roleConfidence: z.number().min(0).max(1),
  url: z.string().url(),
  mimeType: z.string().min(1),
  fileName: z.string().min(1),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  userAssignedRole: assetRoleSchema.nullable().optional(),
  suggestedUse: z.string().nullable().optional(),
  warnings: z.array(z.string()).optional(),
});

export const brandKitSchema = z.object({
  brandName: z.string().nullable().optional(),
  slogan: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  primaryColor: z.string().nullable().optional(),
  voice: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
});

export const unifiedVideoGenerationRequestSchema = z.object({
  userType: userTypeSchema,
  rawPrompt: z.string().min(1).max(4000),
  attachments: z.array(uploadedAssetSchema).max(20),
  selectedDuration: supportedDurationSchema,
  selectedAspectRatio: aspectRatioSchema,
  selectedBrandEndingMode: brandEndingModeSchema,
  cta: z.string().max(500).nullable().optional(),
  platform: targetPlatformSchema.nullable().optional(),
  brandKit: brandKitSchema.nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  advancedOptions: z.record(z.string(), z.unknown()).nullable().optional(),
  deliveryOrderId: z.string().nullable().optional(),
});

export type UnifiedVideoGenerationRequestInput = z.infer<
  typeof unifiedVideoGenerationRequestSchema
>;

export const inputClassificationSchema = z.object({
  userType: userTypeSchema,
  generationMode: generationModeSchema,
  videoGoal: videoGoalSchema,
  targetPlatform: targetPlatformSchema,
  needsCTA: z.boolean(),
  needsBrandPackaging: z.boolean(),
  needsUserClipInsertion: z.boolean(),
  confidence: z.number().min(0).max(1),
  missingFields: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const creativeBriefSchema = z.object({
  hook: z.string().min(1),
  narrative: z.string().min(1),
  targetAudience: z.string().min(1),
  corePainPoint: z.string().min(1),
  emotionalAngle: z.string().min(1),
  keySellingPoints: z.array(z.string()),
  cta: z.string().nullable().optional(),
  platformFit: z.string().min(1),
  recommendedDurationReason: z.string().min(1),
  angleVariants: z.array(
    z.object({
      title: z.string(),
      hook: z.string(),
      angle: z.string(),
    }),
  ),
});

export const segmentTypeSchema = z.enum([
  "ai_generated_clip",
  "uploaded_clip",
  "brand_end_card",
  "cta_card",
]);

export const segmentRoleSchema = z.enum([
  "hook",
  "intro",
  "demo",
  "lifestyle",
  "benefit",
  "cta",
  "outro",
]);

export const videoSegmentSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  type: segmentTypeSchema,
  role: segmentRoleSchema,
  durationSeconds: z.number().positive(),
  purpose: z.string(),
  prompt: z.string().nullable().optional(),
  negativePrompt: z.string().nullable().optional(),
  sourceAssetIds: z.array(z.string()),
  uploadedAssetId: z.string().nullable().optional(),
  cameraDirection: z.string().nullable().optional(),
  visualDirection: z.string().nullable().optional(),
  outputSpec: z.object({
    aspectRatio: aspectRatioSchema,
    resolution: z.string(),
  }),
});

export const brandRenderStrategySchema = z.enum([
  "render_ffmpeg_overlay",
  "use_uploaded_clip",
  "no_end_card",
]);

export const brandPackagingPlanSchema = z.object({
  mode: brandEndingModeSchema,
  logoAssetId: z.string().nullable().optional(),
  endCardDurationSeconds: z.number().nonnegative(),
  cta: z.string().nullable().optional(),
  brandName: z.string().nullable().optional(),
  slogan: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  uploadedEndingClipAssetId: z.string().nullable().optional(),
  renderStrategy: brandRenderStrategySchema,
  warnings: z.array(z.string()),
});

export const clipPositionSchema = z.enum([
  "beginning",
  "middle",
  "before_cta",
  "end",
]);

export const clipPlacementDecisionSchema = z.object({
  uploadedAssetId: z.string(),
  role: assetRoleSchema,
  position: clipPositionSchema,
  targetSegmentOrder: z.number().int().nonnegative(),
  replacesAISegment: z.boolean(),
});

export const clipPlacementPlanSchema = z.object({
  decisions: z.array(clipPlacementDecisionSchema),
  warnings: z.array(z.string()),
});

export const assemblyClipSchema = z.object({
  segmentOrder: z.number().int().nonnegative(),
  sourceType: segmentTypeSchema,
  sourceVideoJobId: z.string().nullable().optional(),
  uploadedAssetId: z.string().nullable().optional(),
  fromSec: z.number().nonnegative(),
  toSec: z.number().nonnegative(),
  normalize: z.boolean(),
});

export const assemblyPlanSchema = z.object({
  targetResolution: z.string(),
  aspectRatio: aspectRatioSchema,
  fps: z.number().int().positive(),
  outputCodec: z.literal("h264_aac_mp4"),
  clips: z.array(assemblyClipSchema),
  transitions: z.array(z.enum(["cut", "match_cut", "fade"])),
  finalDurationSeconds: z.number().positive(),
  normalizationPlan: z.string(),
});

export const qualityIssueSchema = z.object({
  severity: z.enum(["blocker", "warning", "suggestion"]),
  code: z.string(),
  message: z.string(),
  segmentOrder: z.number().int().nonnegative().nullable().optional(),
  assetId: z.string().nullable().optional(),
});

export const qualityReviewSchema = z.object({
  score: z.number().min(0).max(100),
  blockers: z.array(qualityIssueSchema),
  warnings: z.array(qualityIssueSchema),
  suggestions: z.array(qualityIssueSchema),
  canDispatch: z.boolean(),
});

export const planPreviewSchema = z.object({
  summary: z.string(),
  breakdown: z.object({
    aiClipCount: z.number().int().nonnegative(),
    uploadedClipCount: z.number().int().nonnegative(),
    hasBrandEndCard: z.boolean(),
    finalDurationSec: z.number().positive(),
    aspectRatio: aspectRatioSchema,
  }),
});

export const videoGenerationPlanSchema = z.object({
  id: z.string(),
  inputClassification: inputClassificationSchema,
  classifiedAssets: z.array(uploadedAssetSchema),
  creativeBrief: creativeBriefSchema,
  segments: z.array(videoSegmentSchema),
  seedancePrompts: z.array(
    z.object({
      segmentOrder: z.number().int().nonnegative(),
      prompt: z.string(),
      negativePrompt: z.string(),
      referenceImageUrls: z.array(z.string().url()),
    }),
  ),
  brandPackagingPlan: brandPackagingPlanSchema,
  clipPlacementPlan: clipPlacementPlanSchema,
  assemblyPlan: assemblyPlanSchema,
  qualityReview: qualityReviewSchema,
  planPreview: planPreviewSchema,
  createdAt: z.string(),
});

export type VideoGenerationPlanParsed = z.infer<typeof videoGenerationPlanSchema>;

/**
 * 单文件分类请求 schema（POST /api/video-generation/classify-asset）。
 * 比 UploadedAsset 简化，只需要够分类器推断的最小字段。
 */
export const classifyAssetRequestSchema = z.object({
  url: z.string().url(),
  mimeType: z.string().min(1),
  fileName: z.string().min(1),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  fileSizeBytes: z.number().int().nonnegative().nullable().optional(),
});

export type ClassifyAssetRequest = z.infer<typeof classifyAssetRequestSchema>;
