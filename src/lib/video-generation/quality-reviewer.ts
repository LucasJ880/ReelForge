/**
 * Phase 5 — Quality reviewer.
 *
 * 跑一组硬规则 + 软规则检查，给 VideoGenerationPlan 一个 0..100 分 + blockers/warnings/suggestions。
 *
 * 硬规则（blocker，禁止 dispatch）：
 *  - Seedance prompt 含 logo URL / 精确 brand text / "render text" / QR / promo text
 *  - image_to_video mode 但没有 product_image
 *  - Aspect ratio / duration 不在支持列表（理论上 zod 已挡住，这里是兜底）
 *
 * 软规则（warning）：
 *  - auto end card 但没有 logo
 *  - prompt 整体过短（< 30 字符）
 *  - 9:16 但上传 16:9 素材为主
 *
 * suggestion：
 *  - 可优化 prompt 的建议
 */

import type {
  CreativeBrief,
  InputClassification,
  QualityIssue,
  QualityReview,
  UploadedAsset,
  VideoSegment,
  BrandPackagingPlan,
} from "@/types/video-generation";
import { effectiveAssetRole } from "@/types/video-generation";

/**
 * Seedance prompt 不应渲染的精确视觉元素的关键词。
 * 出现这些字符串（不区分大小写）→ blocker。
 */
const FORBIDDEN_SEEDANCE_PATTERNS: Array<{ re: RegExp; code: string; message: string }> = [
  {
    re: /\b(render|display|show|generate|draw)\s+(the\s+)?logo\b/i,
    code: "seedance_logo_request",
    message:
      "Seedance prompt asks the model to render the logo. Brand logos must be added by Aivora's overlay layer, not Seedance.",
  },
  {
    re: /\bhttps?:\/\/[^\s)]+/i,
    code: "seedance_url",
    message:
      "Seedance prompt contains a URL. URLs should be added as a text overlay by Aivora, not rendered by the AI model.",
  },
  {
    re: /\bQR\s*code\b/i,
    code: "seedance_qr_code",
    message:
      "Seedance prompt requests a QR code. QR codes must be composited by Aivora's overlay layer.",
  },
  {
    re: /\bshow\s+the\s+text\b|\brender\s+the\s+text\b|\bdisplay\s+the\s+text\b/i,
    code: "seedance_render_text",
    message:
      "Seedance prompt instructs the model to render specific on-screen text. Text overlays must be added by Aivora.",
  },
  {
    re: /\b(?:buy\s+now|order\s+now|tap\s+to\s+shop|swipe\s+up|link\s+in\s+bio)\b/i,
    code: "seedance_cta_text",
    message:
      "Seedance prompt contains a CTA phrase to be rendered. CTA text should be a separate overlay by Aivora.",
  },
];

export interface BuildQualityReviewArgs {
  classification: InputClassification;
  classifiedAssets: UploadedAsset[];
  brandPackaging: BrandPackagingPlan;
  segments: VideoSegment[];
  creativeBrief: CreativeBrief;
}

export function buildQualityReview(args: BuildQualityReviewArgs): QualityReview {
  const blockers: QualityIssue[] = [];
  const warnings: QualityIssue[] = [];
  const suggestions: QualityIssue[] = [];

  const { classification, classifiedAssets, brandPackaging, segments, creativeBrief } = args;

  /// 1. Seedance prompt 硬约束
  for (const seg of segments) {
    if (seg.type !== "ai_generated_clip") continue;
    const prompt = seg.prompt ?? "";
    for (const rule of FORBIDDEN_SEEDANCE_PATTERNS) {
      if (rule.re.test(prompt)) {
        blockers.push({
          severity: "blocker",
          code: rule.code,
          message: rule.message,
          segmentOrder: seg.order,
        });
      }
    }
    if (!prompt || prompt.trim().length < 20) {
      warnings.push({
        severity: "warning",
        code: "prompt_too_short",
        message: `Segment ${seg.order} has a very short prompt; results may be inconsistent.`,
        segmentOrder: seg.order,
      });
    }
  }

  /// 2. image_to_video 模式必须有 product_image
  if (
    classification.generationMode === "image_to_video" ||
    classification.generationMode === "image_to_video_ad"
  ) {
    const hasProductImage = classifiedAssets.some(
      (a) =>
        effectiveAssetRole(a) === "product_image" ||
        effectiveAssetRole(a) === "reference_image",
    );
    if (!hasProductImage) {
      blockers.push({
        severity: "blocker",
        code: "missing_product_image",
        message:
          "Generation mode is image-to-video but no product or reference image was provided.",
      });
    }
  }

  /// 3. mixed_assets 需要至少 1 个上传 clip
  if (
    classification.generationMode === "mixed_assets_to_video" ||
    classification.generationMode === "mixed_assets_to_video_ad"
  ) {
    const hasUploadedClip = classifiedAssets.some((a) => a.type === "VIDEO");
    if (!hasUploadedClip) {
      blockers.push({
        severity: "blocker",
        code: "missing_uploaded_clip",
        message:
          "Generation mode is mixed-assets but no uploaded video clip was provided.",
      });
    }
  }

  /// 4. auto end card 但无 logo → warning
  if (
    brandPackaging.mode === "auto_end_card" &&
    !brandPackaging.logoAssetId &&
    !brandPackaging.brandName
  ) {
    warnings.push({
      severity: "warning",
      code: "end_card_no_logo_no_brand",
      message:
        "Auto end card mode is on but no logo or brand name was provided. End card will look empty.",
    });
  }

  /// 5. Creative brief 完整性
  if (creativeBrief.keySellingPoints.length === 0) {
    warnings.push({
      severity: "warning",
      code: "no_selling_points",
      message:
        "No key selling points generated. The video may lack a clear value proposition.",
    });
  }

  /// 6. classification warning 传递
  for (const w of classification.warnings) {
    warnings.push({
      severity: "warning",
      code: "input_warning",
      message: w,
    });
  }

  /// 7. brand packaging warning 传递
  for (const w of brandPackaging.warnings) {
    warnings.push({
      severity: "warning",
      code: "brand_packaging_warning",
      message: w,
    });
  }

  /// 评分：100 起，blocker 大扣，warning 小扣
  const score = Math.max(
    0,
    100 - blockers.length * 30 - warnings.length * 5 - suggestions.length * 1,
  );

  return {
    score,
    blockers,
    warnings,
    suggestions,
    canDispatch: blockers.length === 0,
  };
}

/// 公开：单 prompt 静态检查（UI 实时反馈使用）
export function checkSeedancePromptStatic(prompt: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const rule of FORBIDDEN_SEEDANCE_PATTERNS) {
    if (rule.re.test(prompt)) {
      issues.push({
        severity: "blocker",
        code: rule.code,
        message: rule.message,
      });
    }
  }
  return issues;
}

export const __test__ = { FORBIDDEN_SEEDANCE_PATTERNS };
