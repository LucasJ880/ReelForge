/**
 * Phase 5 — Brand packaging plan.
 *
 * 输入：UnifiedVideoGenerationRequest + InputClassification + 分类后的 attachments
 * 输出：BrandPackagingPlan
 *
 * 硬约束（Aivora 决不把这些交给 Seedance 渲染）：
 *  - 精确 logo 图像
 *  - 品牌名 / slogan / website / 二维码 / 促销文字
 *  - CTA 按钮文本
 *
 * Phase 1 不真实渲染 end card；只生成 plan。Phase 2 接 ffmpeg overlay。
 */

import { effectiveAssetRole } from "@/types/video-generation";
import type {
  BrandPackagingPlan,
  BrandRenderStrategy,
  InputClassification,
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "@/types/video-generation";
import { applySunnyShutterBrandPack } from "@/lib/video-generation/sunnyshutter-brand-pack";

export interface BuildBrandPackagingArgs {
  request: UnifiedVideoGenerationRequest;
  classification: InputClassification;
  classifiedAssets: UploadedAsset[];
}

/** auto end card 时长（秒）—— 与时长选项匹配的保守值 */
function defaultEndCardDuration(totalSec: number): number {
  if (totalSec <= 15) return 2;
  if (totalSec <= 30) return 3;
  return 4;
}

function disclosureEndCardEnabled(): boolean {
  return ["1", "true", "yes"].includes(
    process.env.AI_DISCLOSURE_END_CARD_ENABLED?.toLowerCase() ?? "",
  );
}

export function buildBrandPackagingPlan(
  args: BuildBrandPackagingArgs,
): BrandPackagingPlan {
  const { request, classification, classifiedAssets } = args;
  const warnings: string[] = [];
  const disclosureEnabled = disclosureEndCardEnabled();

  const sunnyHints = {
    brandName: request.brandKit?.brandName,
    cta: request.cta,
    language: request.language,
    aspectRatio: request.selectedAspectRatio,
  };

  /// Personal 模式 + 用户没要 brand → 不做品牌包装
  /// （SunnyShutter 仍会被 applySunnyShutterBrandPack 强制加回真实广告尾卡）
  if (!classification.needsBrandPackaging || request.selectedBrandEndingMode === "none") {
    if (disclosureEnabled) {
      return applySunnyShutterBrandPack(
        {
          mode: "auto_end_card",
          logoAssetId: null,
          endCardDurationSeconds: 2,
          cta: "Created with AI",
          brandName: "AI Generated · Aivora",
          slogan: null,
          website: null,
          renderStrategy: "render_ffmpeg_overlay",
          warnings: ["AI disclosure end card enabled by deployment policy."],
        },
        sunnyHints,
      );
    }
    return applySunnyShutterBrandPack(
      {
        mode: "none",
        endCardDurationSeconds: 0,
        cta: null,
        brandName: request.brandKit?.brandName ?? null,
        slogan: request.brandKit?.slogan ?? null,
        website: request.brandKit?.website ?? null,
        renderStrategy: "no_end_card",
        warnings,
      },
      sunnyHints,
    );
  }

  /// uploaded ending clip 优先
  const uploadedOutro = classifiedAssets.find(
    (a) =>
      effectiveAssetRole(a) === "outro_clip" ||
      effectiveAssetRole(a) === "logo_animation",
  );

  let plan: BrandPackagingPlan;
  if (request.selectedBrandEndingMode === "uploaded_clip") {
    if (!uploadedOutro) {
      warnings.push(
        "Uploaded clip mode selected but no outro/logo_animation asset was found. Falling back to auto end card.",
      );
      plan = autoEndCard(args, warnings);
    } else {
      plan = {
        mode: "uploaded_clip",
        logoAssetId: classifiedAssets.find(
          (a) => effectiveAssetRole(a) === "logo",
        )?.id ?? null,
        endCardDurationSeconds: Math.min(
          uploadedOutro.durationSeconds ?? 5,
          5,
        ),
        cta: request.cta ?? null,
        brandName: request.brandKit?.brandName ?? null,
        slogan: request.brandKit?.slogan ?? null,
        website: request.brandKit?.website ?? null,
        uploadedEndingClipAssetId: uploadedOutro.id,
        renderStrategy: "use_uploaded_clip",
        warnings,
      };
    }
  } else {
    /// 默认：auto end card
    plan = autoEndCard(args, warnings);
  }

  /// SunnyShutter: force locked real-ad end card (logo + phone + address).
  return applySunnyShutterBrandPack(plan, {
    ...sunnyHints,
    brandName: plan.brandName ?? request.brandKit?.brandName,
    cta: plan.cta ?? request.cta,
  });
}

function autoEndCard(
  args: BuildBrandPackagingArgs,
  warnings: string[],
): BrandPackagingPlan {
  const { request, classifiedAssets } = args;

  const logo = classifiedAssets.find((a) => effectiveAssetRole(a) === "logo");
  const logoUrl = logo?.url ?? request.brandKit?.logoUrl ?? null;

  if (!logoUrl) {
    warnings.push(
      "No logo asset provided. End card will use brand name text only.",
    );
  }

  if (!request.cta && !request.brandKit?.brandName) {
    warnings.push(
      "Neither CTA nor brand name was provided. End card may look empty.",
    );
  }

  const strategy: BrandRenderStrategy = "render_ffmpeg_overlay";

  return {
    mode: "auto_end_card",
    logoAssetId: logo?.id ?? null,
    endCardDurationSeconds: defaultEndCardDuration(
      request.selectedDuration,
    ),
    cta: request.cta ?? null,
    brandName: request.brandKit?.brandName ?? null,
    slogan: disclosureEndCardEnabled()
      ? [request.brandKit?.slogan, "AI Generated · Aivora"].filter(Boolean).join(" · ")
      : request.brandKit?.slogan ?? null,
    website: request.brandKit?.website ?? null,
    renderStrategy: strategy,
    warnings,
  };
}
