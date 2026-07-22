/**
 * Phase 5 — Unified Video Generation type model.
 *
 * 唯一权威的 TS 类型定义（Zod 运行时校验在 src/lib/schemas/unified-input.ts）。
 *
 * 关键设计原则：
 * 1. 前端只需要构造 `UnifiedVideoGenerationRequest`，其余结构由 pipeline 自动派生。
 * 2. `VideoGenerationPlan` 是 supervisor 输出的完整快照；`DirectorPlan`（src/lib/schemas/director-plan.ts）
 *    是其 prompt 子集。两者可互相 adapter（见 src/lib/video-generation/prompt-intelligence.ts）。
 * 3. 所有可空字段必须显式 `null` 或省略，不接受 `undefined` 序列化进 DB（防止 Prisma JSON 漂移）。
 */

import type { SupportedDurationSec } from "@/lib/duration/segment-planner";

// ---------- User-type + generation mode ----------

/** `platform` is the Phase 1 unified account-neutral creation surface. */
export type UserType = "business" | "personal" | "platform";

export type GenerationMode =
  | "text_to_video"
  | "image_to_video"
  | "mixed_assets_to_video"
  | "text_to_video_ad"
  | "image_to_video_ad"
  | "mixed_assets_to_video_ad";

export type VideoGoal =
  | "product_ad"
  | "product_showcase"
  | "ugc_style_ad"
  | "lifestyle_ad"
  | "promo_ad"
  | "personal_creative"
  | "personal_lifestyle"
  | "personal_clip";

export type TargetPlatform = "tiktok" | "instagram_reels" | "youtube_shorts" | "generic_vertical";

export type AspectRatio = "9:16" | "16:9" | "1:1";

export type BrandEndingMode = "auto_end_card" | "uploaded_clip" | "none";

// ---------- Uploaded asset model ----------

/**
 * Inferred role for an uploaded asset.
 * - product_image: 商品主图，用作 image-to-video 参考
 * - reference_image: 风格/概念参考，不强制 product consistency
 * - logo: 品牌 logo（透明背景或方形小图）—— 不进 Seedance prompt
 * - intro_clip: 短开场（≤5s）
 * - outro_clip / logo_animation: 末尾（≤5s）
 * - ad_clip / product_demo_clip: 中段商业素材（5-15s）
 * - store_clip: 店铺/场景实拍（>15s）
 * - existing_commercial: 已有完整广告片
 */
export type AssetRole =
  | "product_image"
  | "reference_image"
  | "logo"
  | "intro_clip"
  | "outro_clip"
  | "ad_clip"
  | "store_clip"
  | "product_demo_clip"
  | "logo_animation"
  | "existing_commercial"
  | "unknown";

export interface UploadedAsset {
  /** Durable server-owned identity. Historical plan snapshots may not have one. */
  assetId?: string | null;
  id: string;
  /// 原始声明类型（来自 mime/ext，VIDEO/IMAGE/AUDIO）
  type: "VIDEO" | "IMAGE" | "AUDIO";
  /// asset-classifier 推断角色
  inferredRole: AssetRole;
  /// 0..1，UI 用于显示「请确认」
  roleConfidence: number;
  url: string;
  mimeType: string;
  fileName: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  /// 用户手动覆盖（优先于 inferredRole）
  userAssignedRole?: AssetRole | null;
  /// suggestedUse: classifier 给的人类可读建议
  suggestedUse?: string | null;
  /// warnings: 分类器发现的潜在问题（如「这个图分辨率太低，建议作为参考图」）
  warnings?: string[];
}

/** URL-free media reference accepted by new customer creation endpoints. */
export interface OwnedCreationAssetInput {
  assetId: string;
  inferredRole: AssetRole;
  roleConfidence: number;
  fileName: string;
  durationSeconds?: number | null;
  userAssignedRole?: AssetRole | null;
  suggestedUse?: string | null;
  warnings?: string[];
}

/** 资源在 pipeline 内部使用的角色（用户覆盖优先） */
export function effectiveAssetRole(asset: UploadedAsset): AssetRole {
  return asset.userAssignedRole ?? asset.inferredRole;
}

// ---------- Brand kit ----------

export interface BrandKit {
  brandName?: string | null;
  slogan?: string | null;
  website?: string | null;
  primaryColor?: string | null;
  voice?: string | null;
  /// 当前选中的 logo URL（可能来自 LogoGeneration 选中项或 brand assets 直接上传）
  logoUrl?: string | null;
}

// ---------- Unified request (前端表单 → 后端入口) ----------

export interface UnifiedVideoGenerationRequest {
  userType: UserType;
  rawPrompt: string;
  attachments: UploadedAsset[];
  selectedDuration: SupportedDurationSec;
  selectedAspectRatio: AspectRatio;
  selectedBrandEndingMode: BrandEndingMode;
  cta?: string | null;
  platform?: TargetPlatform | null;
  brandKit?: BrandKit | null;
  /// 可选：language hint，例如 "zh-CN" / "en-US"；默认走 platform 推断
  language?: string | null;
  /// 风格模版 ID（style-templates.ts；skill 模式，后端注入视觉/镜头/台词风格）
  styleTemplateId?: string | null;
  /// 一致性锁 ID 列表（可叠加追加 prompt 约束）
  consistencyLockIds?: string[] | null;
  /// Phase 1 不开放高级选项；保留字段
  advancedOptions?: Record<string, unknown> | null;
  /// 关联到已有 DeliveryOrder（continuation 场景）；缺省时 supervisor 会新建
  deliveryOrderId?: string | null;
}

export type OwnedUnifiedVideoGenerationRequest = Omit<
  UnifiedVideoGenerationRequest,
  "attachments"
> & {
  attachments: OwnedCreationAssetInput[];
};

export function toOwnedCreationAsset(
  asset: UploadedAsset,
): OwnedCreationAssetInput {
  const assetId = asset.assetId ?? asset.id;
  if (!assetId) {
    throw new Error("Uploaded asset is missing its server-owned ID");
  }
  return {
    assetId,
    inferredRole: asset.inferredRole,
    roleConfidence: asset.roleConfidence,
    fileName: asset.fileName,
    durationSeconds: asset.durationSeconds ?? null,
    userAssignedRole: asset.userAssignedRole ?? null,
    suggestedUse: asset.suggestedUse ?? null,
    warnings: asset.warnings ?? [],
  };
}

export function toOwnedCreationRequest(
  request: UnifiedVideoGenerationRequest,
): OwnedUnifiedVideoGenerationRequest {
  const brandKit = request.brandKit
    ? (({ logoUrl: _logoUrl, ...ownedFields }) => ownedFields)(request.brandKit)
    : request.brandKit;
  return {
    ...request,
    brandKit,
    attachments: request.attachments.map(toOwnedCreationAsset),
  };
}

// ---------- Classification outputs ----------

export interface InputClassification {
  userType: UserType;
  generationMode: GenerationMode;
  videoGoal: VideoGoal;
  targetPlatform: TargetPlatform;
  needsCTA: boolean;
  needsBrandPackaging: boolean;
  needsUserClipInsertion: boolean;
  /// 0..1 总体置信度
  confidence: number;
  /// 缺失但建议补齐的字段（如 "missing logo for auto end card"）
  missingFields: string[];
  warnings: string[];
}

// ---------- Consistency bible（跨镜头一致性锚点） ----------

/**
 * 全片一致性圣经：在 plan 阶段生成一次，之后逐段 prompt 里**逐字复用**，
 * 保证多镜头/多段生成时人物、场景、产品、光线弧完全一致。
 * 这是对齐同行成片质量的核心机制（同行用「角色板+产品板」，我们用
 * 文字锚 + Omni-Reference 参考图双保险）。
 */
export interface ConsistencyBible {
  /// 主角完整外观描述（性别/年龄/发型/肤色/服装/气质），每段 prompt 逐字引用
  characterProfile: string;
  /// 场景环境描述（空间/家具/窗景/色调），每段 prompt 逐字引用
  environmentProfile: string;
  /// 产品视觉描述（颜色/材质/形态/尺寸感），与参考图互为锚定
  productDescription: string;
  /// 光线叙事弧：按 segment 顺序描述光线如何推进故事（如「刺眼晨光→全黑→柔和晨光」）
  lightingArc: string[];
  /// 口播语言与声线（如 "en-US, casual excited female voice"）；null = 无口播
  voiceProfile: string | null;
  /// 全片统一风格关键词（如 "authentic handheld phone footage, realistic skin texture"）
  styleKeywords: string;
}

// ---------- Creative brief ----------

export interface CreativeBrief {
  /// 主 hook（首 2 秒视觉）
  hook: string;
  narrative: string;
  targetAudience: string;
  corePainPoint: string;
  emotionalAngle: string;
  keySellingPoints: string[];
  /// CTA 文案（Personal 模式 null）
  cta?: string | null;
  /// 推荐的 platform fit 描述
  platformFit: string;
  /// LLM 给出的为什么推荐这个时长
  recommendedDurationReason: string;
  /// 仅 Business 模式：3-5 个广告方向 variants（变体）；Personal 模式空数组
  angleVariants: Array<{
    title: string;
    hook: string;
    angle: string;
  }>;
}

// ---------- Video segment ----------

export type SegmentType =
  | "ai_generated_clip"
  | "uploaded_clip"
  | "brand_end_card"
  | "cta_card";

export type SegmentRole =
  | "hook"
  | "intro"
  | "demo"
  | "lifestyle"
  | "benefit"
  | "cta"
  | "outro";

export interface VideoSegment {
  id: string;
  order: number;
  type: SegmentType;
  role: SegmentRole;
  durationSeconds: number;
  purpose: string;
  /// AI 生成段的 prompt（uploaded_clip / end_card 为 null）
  prompt?: string | null;
  negativePrompt?: string | null;
  /// 用于 AI 段：参考资产 ID 列表
  sourceAssetIds: string[];
  /// 仅 uploaded_clip 段：被引用的 attachment id
  uploadedAssetId?: string | null;
  cameraDirection?: string | null;
  visualDirection?: string | null;
  outputSpec: {
    aspectRatio: AspectRatio;
    resolution: string;
  };
}

// ---------- Brand packaging ----------

export type BrandRenderStrategy =
  | "render_ffmpeg_overlay"
  | "use_uploaded_clip"
  | "no_end_card";

export interface BrandPackagingPlan {
  mode: BrandEndingMode;
  logoAssetId?: string | null;
  /// brand end card 段时长（秒）。mode=none 时 0。
  endCardDurationSeconds: number;
  cta?: string | null;
  brandName?: string | null;
  slogan?: string | null;
  website?: string | null;
  /// 联系方式行（电话 / 地址等），按序渲染在 CTA 与 website 之间；最多取前 3 行。
  /// 广告成片必备（2026-07 客户要求：片尾必须有电话+地址，否则只是"艺术片"）。
  contactLines?: string[] | null;
  /// Optional designed still (Image2 / locked client art). When set, the
  /// end-card renderer prefers this PNG as the background and burns exact
  /// brand/contact typography on top so phone/address never hallucinate.
  endCardStillUrl?: string | null;
  /// Full-video logo watermark corner. SunnyShutter locks this to top-left.
  logoOverlayPlacement?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | null;
  /// 用户选用上传 clip 作为结尾时，引用对应 attachment id
  uploadedEndingClipAssetId?: string | null;
  renderStrategy: BrandRenderStrategy;
  /// 投资人/品牌片场景：true 时 end card 不渲染按钮形 CTA（无 "Learn more" 块），
  /// 只保留 brandName + slogan + website 这种最简洁的高端排版。
  /// 默认（undefined / false）保持向后兼容的按钮 CTA 渲染。
  hideCta?: boolean;
  /// supervisor 收集的 warnings（如 "no logo, will defer to manual review"）
  warnings: string[];
}

// ---------- Clip placement ----------

export type ClipPosition = "beginning" | "middle" | "before_cta" | "end";

export interface ClipPlacementDecision {
  uploadedAssetId: string;
  role: AssetRole;
  position: ClipPosition;
  /// 计划被插入到这个 segment 索引（视频拼接顺序）
  targetSegmentOrder: number;
  /// 是否替换某个原本的 AI 段（true）还是追加（false）
  replacesAISegment: boolean;
}

export interface ClipPlacementPlan {
  decisions: ClipPlacementDecision[];
  warnings: string[];
}

// ---------- Assembly plan ----------

export interface AssemblyClip {
  segmentOrder: number;
  sourceType: SegmentType;
  /// AI segment 用 sourceVideoJobId（dispatch 后填充）；上传 clip 用 uploadedAssetId
  sourceVideoJobId?: string | null;
  uploadedAssetId?: string | null;
  fromSec: number;
  toSec: number;
  /// 拼接时是否做色调统一 / loudness normalize
  normalize: boolean;
}

export interface AssemblyPlan {
  targetResolution: string;
  aspectRatio: AspectRatio;
  fps: number;
  outputCodec: "h264_aac_mp4";
  clips: AssemblyClip[];
  /// 段间转场（Phase 1 默认全 cut）
  transitions: Array<"cut" | "match_cut" | "fade">;
  finalDurationSeconds: number;
  /// 规一化策略描述（人类可读）
  normalizationPlan: string;
}

// ---------- Quality review ----------

export interface QualityIssue {
  severity: "blocker" | "warning" | "suggestion";
  code: string;
  message: string;
  /// 关联到哪个 segment 或 asset（可选）
  segmentOrder?: number | null;
  assetId?: string | null;
}

export interface QualityReview {
  /// 0..100 分数
  score: number;
  blockers: QualityIssue[];
  warnings: QualityIssue[];
  suggestions: QualityIssue[];
  /// supervisor 是否允许 dispatch（有 blocker 时 false）
  canDispatch: boolean;
}

// ---------- Plan preview ----------

export interface PlanPreview {
  /// 人类可读单句描述（用户在 UI 看到的最重要的一行）
  summary: string;
  /// 结构化摘要（UI 渲染 breakdown 卡片用）
  breakdown: {
    aiClipCount: number;
    uploadedClipCount: number;
    hasBrandEndCard: boolean;
    finalDurationSec: number;
    aspectRatio: AspectRatio;
  };
}

// ---------- Top-level plan ----------

export interface VideoGenerationPlan {
  /// supervisor 生成时填的 UUID；dispatch 后入库为 brief.id 关联
  id: string;
  inputClassification: InputClassification;
  /// 资产分类副本（asset-classifier 输出，UI 也展示）
  classifiedAssets: UploadedAsset[];
  creativeBrief: CreativeBrief;
  /// 跨镜头一致性圣经（2026-07 质量对齐新增；旧 plan 可能缺省）
  consistencyBible?: ConsistencyBible | null;
  segments: VideoSegment[];
  /// supervisor 维护的"最终发给 Seedance 的 prompts"快照（按 segment 顺序）
  seedancePrompts: Array<{
    segmentOrder: number;
    prompt: string;
    negativePrompt: string;
    referenceImageUrls: string[];
  }>;
  brandPackagingPlan: BrandPackagingPlan;
  clipPlacementPlan: ClipPlacementPlan;
  assemblyPlan: AssemblyPlan;
  qualityReview: QualityReview;
  planPreview: PlanPreview;
  /// supervisor 生成时间
  createdAt: string;
}
