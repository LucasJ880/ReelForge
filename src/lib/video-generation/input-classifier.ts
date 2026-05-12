/**
 * Phase 5 — Input classifier.
 *
 * 纯规则分类器：根据 UnifiedVideoGenerationRequest 推断
 *   - generationMode（text/image/mixed × ad/personal）
 *   - videoGoal
 *   - needsCTA / needsBrandPackaging / needsUserClipInsertion
 *   - missingFields / warnings
 *
 * Phase 1 不调 LLM。Phase 2 可以在这里加 LLM hook 做 fuzzy classification。
 */

import { effectiveAssetRole, type UnifiedVideoGenerationRequest, type InputClassification, type GenerationMode, type VideoGoal, type TargetPlatform } from "@/types/video-generation";

export function classifyInput(
  request: UnifiedVideoGenerationRequest,
): InputClassification {
  const attachments = request.attachments ?? [];
  const hasAttachments = attachments.length > 0;

  const hasImage = attachments.some((a) => a.type === "IMAGE" && effectiveAssetRole(a) !== "logo");
  const hasVideo = attachments.some((a) => a.type === "VIDEO");
  const hasLogo = attachments.some((a) => effectiveAssetRole(a) === "logo");
  const hasUploadedClip = attachments.some((a) => {
    const role = effectiveAssetRole(a);
    return (
      role === "intro_clip" ||
      role === "outro_clip" ||
      role === "ad_clip" ||
      role === "store_clip" ||
      role === "product_demo_clip" ||
      role === "logo_animation" ||
      role === "existing_commercial"
    );
  });

  const isBusiness = request.userType === "business";

  // generation mode
  let generationMode: GenerationMode;
  if (!hasAttachments) {
    generationMode = isBusiness ? "text_to_video_ad" : "text_to_video";
  } else if (hasVideo || (hasImage && hasUploadedClip)) {
    generationMode = isBusiness ? "mixed_assets_to_video_ad" : "mixed_assets_to_video";
  } else if (hasImage) {
    generationMode = isBusiness ? "image_to_video_ad" : "image_to_video";
  } else {
    // 只有 logo 没有 image / video — 视为 text-to-video，logo 走 brand packaging
    generationMode = isBusiness ? "text_to_video_ad" : "text_to_video";
  }

  // video goal
  let videoGoal: VideoGoal;
  if (isBusiness) {
    if (hasImage && !hasUploadedClip) videoGoal = "product_showcase";
    else if (hasUploadedClip) videoGoal = "ugc_style_ad";
    else videoGoal = "product_ad";
  } else {
    if (hasImage) videoGoal = "personal_creative";
    else if (hasVideo) videoGoal = "personal_clip";
    else videoGoal = "personal_lifestyle";
  }

  // platform
  const targetPlatform: TargetPlatform =
    request.platform ??
    (request.selectedAspectRatio === "9:16" ? "tiktok" : "generic_vertical");

  // needs
  const needsCTA = isBusiness;
  const needsBrandPackaging =
    isBusiness && request.selectedBrandEndingMode !== "none";
  const needsUserClipInsertion = hasUploadedClip;

  // confidence: 高，规则系统几乎都能精确分
  let confidence = 0.9;
  if (!hasAttachments && request.rawPrompt.trim().length < 20) {
    confidence = 0.6; // 非常稀疏的输入
  }

  // missing fields
  const missingFields: string[] = [];
  const warnings: string[] = [];

  if (isBusiness && needsBrandPackaging && request.selectedBrandEndingMode === "auto_end_card") {
    if (!hasLogo && !request.brandKit?.logoUrl) {
      missingFields.push("logo");
      warnings.push(
        "Auto end card mode is on but no logo was provided. The end card will use brand name text only.",
      );
    }
    if (!request.cta && !request.brandKit?.brandName) {
      missingFields.push("cta");
      warnings.push("Auto end card mode is on but no CTA text was provided.");
    }
  }

  if (
    (generationMode === "image_to_video" ||
      generationMode === "image_to_video_ad") &&
    !hasImage
  ) {
    missingFields.push("product_image");
    warnings.push(
      "Generation mode requires a product image but none was provided.",
    );
  }

  if (request.rawPrompt.trim().length < 30) {
    warnings.push("Prompt is short. Consider adding more detail for better results.");
  }

  return {
    userType: request.userType,
    generationMode,
    videoGoal,
    targetPlatform,
    needsCTA,
    needsBrandPackaging,
    needsUserClipInsertion,
    confidence,
    missingFields,
    warnings,
  };
}
