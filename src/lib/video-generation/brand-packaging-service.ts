/**
 * 通用品牌封装模块 — 任意客户「logo 角标 + 名片尾卡」一键后期。
 *
 * 产品决策（2026-07-20 用户/CEO WeChat）：
 *   - 模型只出干净画面；logo / 文字 / 尾卡永远后期拼接（废片率下降的关键）。
 *   - 每条视频可选加不加品牌封装（前端 optional 开关）；SunnyShutter 默认开。
 *   - 模块对所有客户通用：传 logo + 联系方式即可；锁死客户走内置 profile。
 *
 * 流程：裁尾（杀模型假名片幻觉）→ logo 角标 → 名片尾卡渲染 → 拼接。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyBrandOverlay } from "@/lib/video-generation/brand-overlay-renderer";
import { renderBrandEndCard } from "@/lib/video-generation/brand-end-card-renderer";
import { runFfmpegNormalizeAndConcat } from "@/lib/services/stitch-service";
import {
  DEFAULT_TAIL_TRIM_SECONDS,
  trimVideoTail,
} from "@/lib/video-generation/tail-trim";
import {
  SUNNYSHUTTER_END_CARD_COPY,
  SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT,
  SUNNYSHUTTER_LOGO_RELATIVE,
  applySunnyShutterBrandPack,
  sunnyShutterLogoFileUrl,
  sunnyShutterLogoOverlayConfig,
} from "@/lib/video-generation/sunnyshutter-brand-pack";
import type { BrandPackagingPlan } from "@/types/video-generation";

export type BrandContactCard = {
  brandName: string;
  slogan?: string | null;
  cta?: string | null;
  phone?: string | null;
  addressLines?: string[];
  website?: string | null;
  /** 可选：Image2 生成或客户上传的尾卡底图（渲染器在其上精确烧字） */
  endCardStillUrl?: string | null;
};

export type BrandPackagingOptions = {
  /** 全程 logo 角标；默认 true */
  includeLogo?: boolean;
  /** 名片尾卡；默认 true */
  includeEndCard?: boolean;
  /** 拼尾卡前裁掉原片尾部秒数（模型假名片高发区）；默认 0.8 */
  tailTrimSeconds?: number;
  logoPlacement?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  endCardDurationSeconds?: number;
  aspectRatio?: "9:16" | "16:9";
};

export type BrandPackagingInput = {
  /** 原片本地路径（AI 出的干净素材） */
  sourceVideoPath: string;
  /** 锁死客户 profile；"sunnyshutter" 时 logo/电话/地址/角标全部按客户锁 */
  clientProfileId?: "sunnyshutter" | null;
  /** 非锁死客户：自定义品牌信息（clientProfileId 为空时必填） */
  custom?: {
    logoPath: string;
    card: BrandContactCard;
  };
  options?: BrandPackagingOptions;
  outputDir: string;
  outputId: string;
};

export type BrandPackagingResult = {
  localPath: string;
  blobUrl: string;
  steps: {
    tailTrimmedSeconds: number;
    logoApplied: boolean;
    endCardApplied: boolean;
  };
  warnings: string[];
};

function sunnyShutterPlan(aspectRatio: "9:16" | "16:9"): BrandPackagingPlan {
  const copy = SUNNYSHUTTER_END_CARD_COPY.en;
  return applySunnyShutterBrandPack(
    {
      mode: "auto_end_card",
      logoAssetId: null,
      endCardDurationSeconds: copy.endCardDurationSeconds,
      brandName: copy.brandName,
      slogan: copy.slogan,
      cta: copy.cta,
      contactLines: [...copy.contactLines],
      website: copy.website,
      renderStrategy: "render_ffmpeg_overlay",
      warnings: [],
    },
    {
      clientLockProfileId: "sunnyshutter",
      brandName: copy.brandName,
      language: "en",
      aspectRatio,
    },
  );
}

function customPlan(
  card: BrandContactCard,
  durationSeconds: number,
): BrandPackagingPlan {
  const contactLines = [
    ...(card.phone ? [card.phone] : []),
    ...(card.addressLines ?? []),
  ].slice(0, 3);
  return {
    mode: "auto_end_card",
    logoAssetId: null,
    endCardDurationSeconds: durationSeconds,
    brandName: card.brandName,
    slogan: card.slogan ?? null,
    cta: card.cta ?? null,
    contactLines,
    website: card.website ?? null,
    endCardStillUrl: card.endCardStillUrl ?? null,
    renderStrategy: "render_ffmpeg_overlay",
    warnings: [],
  } as BrandPackagingPlan;
}

/**
 * 主入口：对一条干净原片做（可选的）logo 角标 + 名片尾卡封装。
 * includeLogo/includeEndCard 都为 false 时仍会裁尾（假名片不能流向客户）。
 */
export async function applyClientBrandPackaging(
  input: BrandPackagingInput,
): Promise<BrandPackagingResult> {
  const warnings: string[] = [];
  const opts = input.options ?? {};
  const includeLogo = opts.includeLogo ?? true;
  const includeEndCard = opts.includeEndCard ?? true;
  const tailTrim = opts.tailTrimSeconds ?? DEFAULT_TAIL_TRIM_SECONDS;
  const aspectRatio = opts.aspectRatio ?? "9:16";
  const isSunnyShutter = input.clientProfileId === "sunnyshutter";

  if (!isSunnyShutter && !input.custom) {
    throw new Error("brand packaging requires clientProfileId or custom brand info");
  }
  if (isSunnyShutter && (!includeLogo || !includeEndCard)) {
    warnings.push(
      "sunnyshutter default is full branding; logo/end-card was explicitly disabled for this video",
    );
  }

  mkdirSync(input.outputDir, { recursive: true });

  // 1) 裁尾 — 无条件执行，Seedance 假名片永不流向客户
  const trimmedPath = await trimVideoTail(input.sourceVideoPath, {
    tailSeconds: tailTrim,
  });

  // 2) logo 角标
  let workingUrl = trimmedPath;
  if (includeLogo) {
    const logoPath = isSunnyShutter
      ? resolve(process.cwd(), SUNNYSHUTTER_LOGO_RELATIVE)
      : input.custom!.logoPath;
    if (!existsSync(logoPath)) throw new Error(`logo missing: ${logoPath}`);
    const logoCfg = sunnyShutterLogoOverlayConfig();
    const overlay = await applyBrandOverlay({
      sourceVideo: trimmedPath,
      logo: logoPath,
      placement: isSunnyShutter
        ? SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT
        : (opts.logoPlacement ?? "top-left"),
      durationMode: logoCfg.durationMode,
      logoWidthRatio: logoCfg.logoWidthRatio,
      opacity: logoCfg.opacity,
      marginPx: logoCfg.marginPx,
      outputDir: input.outputDir,
    });
    workingUrl = overlay.outputUrl;
  }

  // 3) 尾卡渲染 + 拼接
  let endCardApplied = false;
  let finalUrl = workingUrl;
  if (includeEndCard) {
    const plan = isSunnyShutter
      ? sunnyShutterPlan(aspectRatio)
      : customPlan(
          input.custom!.card,
          Math.max(2, Math.round(opts.endCardDurationSeconds ?? 3)),
        );
    const endCard = await renderBrandEndCard({
      briefId: `${input.outputId}-end`,
      plan,
      aspectRatio,
      logoUrl: isSunnyShutter
        ? sunnyShutterLogoFileUrl()
        : `file://${resolve(input.custom!.logoPath)}`,
    });
    if (!endCard?.url) throw new Error("end card render failed");
    finalUrl = await runFfmpegNormalizeAndConcat({
      finalVideoId: `${input.outputId}-branded`,
      aspectRatio,
      clips: [
        { url: workingUrl, intendedDurationSec: null, trimToFit: false },
        {
          url: endCard.url,
          intendedDurationSec: plan.endCardDurationSeconds,
          trimToFit: true,
        },
      ],
    });
    endCardApplied = true;
  } else if (includeLogo) {
    // 只有 logo 没尾卡：归一化输出保证成片规格一致
    finalUrl = await runFfmpegNormalizeAndConcat({
      finalVideoId: `${input.outputId}-branded`,
      aspectRatio,
      clips: [{ url: workingUrl, intendedDurationSec: null, trimToFit: false }],
    });
  }

  const localPath = resolve(input.outputDir, `${input.outputId}-branded.mp4`);
  const response = await fetch(finalUrl);
  if (!response.ok) throw new Error(`download branded ${response.status}`);
  writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));

  return {
    localPath,
    blobUrl: finalUrl,
    steps: {
      tailTrimmedSeconds: tailTrim,
      logoApplied: includeLogo,
      endCardApplied,
    },
    warnings,
  };
}
