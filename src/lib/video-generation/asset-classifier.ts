/**
 * Phase 5 — Asset classifier.
 *
 * 纯规则推断 inferredRole + confidence。Phase 2 加 vision LLM hook。
 *
 * 输入：单文件 metadata（url, mime, width, height, duration, fileSize, fileName）
 * 输出：AssetRole + 0..1 confidence + suggestedUse + warnings
 *
 * 规则要点：
 *  - 图片
 *    - PNG + 较小尺寸（≤512）→ 候选 logo
 *    - 文件名含 "logo" 关键字 → logo（高 confidence）
 *    - JPG/JPEG/WebP + 大尺寸（≥720）→ product_image
 *    - 其他图片 → reference_image
 *  - 视频
 *    - duration ≤5s → 候选 intro/outro/logo_animation
 *    - duration 5-15s → ad_clip / product_demo_clip
 *    - duration >15s → store_clip / existing_commercial
 *    - 文件名含 "intro"/"opening" → intro_clip
 *    - 文件名含 "outro"/"end"/"closing" → outro_clip
 */

import type { AssetRole } from "@/types/video-generation";

export interface ClassifyAssetInput {
  url: string;
  mimeType: string;
  fileName: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  fileSizeBytes?: number | null;
}

export interface AssetClassification {
  inferredRole: AssetRole;
  roleConfidence: number;
  suggestedUse: string;
  warnings: string[];
}

const LOGO_NAME_RE = /\b(logo|brandmark|mark|emblem)\b/i;
const INTRO_NAME_RE = /\b(intro|opening|opener|title)\b/i;
const OUTRO_NAME_RE = /\b(outro|ending|closing|endcard|end[-_]?card)\b/i;
const STORE_NAME_RE = /\b(store|shop|venue|location)\b/i;
const DEMO_NAME_RE = /\b(demo|tutorial|howto)\b/i;
const PRODUCT_NAME_RE = /\b(product|hero|main)\b/i;
const COMMERCIAL_NAME_RE = /\b(commercial|ad|advert|spot)\b/i;

export function classifyAsset(input: ClassifyAssetInput): AssetClassification {
  const mime = input.mimeType.toLowerCase();
  const name = input.fileName;
  const warnings: string[] = [];

  if (mime.startsWith("audio/")) {
    return {
      inferredRole: "unknown",
      roleConfidence: 0.1,
      suggestedUse:
        "Audio files are not supported as visual references in Phase 1. Consider using as background music in a future update.",
      warnings: ["Audio is not used by the generation pipeline yet."],
    };
  }

  if (mime.startsWith("image/")) {
    const smallSide = Math.min(input.width ?? 0, input.height ?? 0);
    const largeSide = Math.max(input.width ?? 0, input.height ?? 0);

    // High-confidence logo by filename
    if (LOGO_NAME_RE.test(name)) {
      return {
        inferredRole: "logo",
        roleConfidence: 0.95,
        suggestedUse:
          "Will be used on the brand end card (corner watermark or end card). Not sent to Seedance as prompt content.",
        warnings,
      };
    }

    // PNG + small size → likely logo
    if (mime.includes("png") && largeSide > 0 && largeSide <= 512) {
      return {
        inferredRole: "logo",
        roleConfidence: 0.75,
        suggestedUse:
          "Looks like a small PNG — assumed to be a logo. Used on brand end card.",
        warnings:
          smallSide && largeSide / smallSide > 2
            ? ["Logo is unusually wide; consider a square version for better end-card layout."]
            : warnings,
      };
    }

    if (PRODUCT_NAME_RE.test(name)) {
      return {
        inferredRole: "product_image",
        roleConfidence: 0.85,
        suggestedUse:
          "Used as the first-frame reference for Seedance image-to-video generation.",
        warnings,
      };
    }

    if (largeSide >= 720) {
      return {
        inferredRole: "product_image",
        roleConfidence: 0.7,
        suggestedUse:
          "Likely a product photo. Used as the first-frame reference for image-to-video.",
        warnings,
      };
    }

    return {
      inferredRole: "reference_image",
      roleConfidence: 0.55,
      suggestedUse:
        "Used as a style / mood reference for the AI generation prompt.",
      warnings:
        largeSide && largeSide < 480
          ? ["Image is low resolution; consider re-uploading at 720p or higher."]
          : warnings,
    };
  }

  if (mime.startsWith("video/")) {
    const dur = input.durationSeconds ?? 0;

    // High-confidence by filename
    if (INTRO_NAME_RE.test(name)) {
      return {
        inferredRole: "intro_clip",
        roleConfidence: 0.9,
        suggestedUse: "Will be placed at the very beginning of the final video.",
        warnings: dur > 5 ? ["Intro is longer than 5s; consider trimming."] : warnings,
      };
    }
    if (OUTRO_NAME_RE.test(name)) {
      return {
        inferredRole: "outro_clip",
        roleConfidence: 0.9,
        suggestedUse: "Will be placed at the end (overrides auto end card if selected).",
        warnings,
      };
    }
    if (STORE_NAME_RE.test(name)) {
      return {
        inferredRole: "store_clip",
        roleConfidence: 0.85,
        suggestedUse: "Will be placed in the middle or before the CTA segment.",
        warnings,
      };
    }
    if (DEMO_NAME_RE.test(name)) {
      return {
        inferredRole: "product_demo_clip",
        roleConfidence: 0.85,
        suggestedUse: "Will be placed in the demo segment of the final ad.",
        warnings,
      };
    }
    if (COMMERCIAL_NAME_RE.test(name)) {
      return {
        inferredRole: "existing_commercial",
        roleConfidence: 0.85,
        suggestedUse:
          "Treated as an existing commercial. Consider trimming to your favorite 8-15s segment.",
        warnings:
          dur < 5
            ? ["Marked as commercial but very short; may be re-classified as intro_clip."]
            : warnings,
      };
    }

    // Duration-based heuristics
    if (dur > 0 && dur <= 5) {
      return {
        inferredRole: "intro_clip",
        roleConfidence: 0.55,
        suggestedUse:
          "Short clip (≤5s) — defaulting to intro. You can change this to outro / logo animation.",
        warnings,
      };
    }
    if (dur > 5 && dur <= 15) {
      return {
        inferredRole: "ad_clip",
        roleConfidence: 0.6,
        suggestedUse:
          "Mid-length clip — defaulting to ad clip. Will be placed before CTA.",
        warnings,
      };
    }
    if (dur > 15) {
      return {
        inferredRole: "store_clip",
        roleConfidence: 0.55,
        suggestedUse:
          "Longer clip — defaulting to store / b-roll. Consider trimming to the strongest 8-15s segment.",
        warnings: ["Clip is longer than 15s. The pipeline will sample or trim it."],
      };
    }

    // No duration metadata — be conservative
    return {
      inferredRole: "ad_clip",
      roleConfidence: 0.35,
      suggestedUse:
        "Could not read clip duration. Please confirm the role manually.",
      warnings: ["Duration metadata missing; manual confirmation recommended."],
    };
  }

  return {
    inferredRole: "unknown",
    roleConfidence: 0.0,
    suggestedUse: "Unsupported file type. Please upload an image or video.",
    warnings: [`MIME type ${input.mimeType} is not supported.`],
  };
}
