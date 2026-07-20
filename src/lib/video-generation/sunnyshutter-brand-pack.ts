/**
 * SunnyShutter-only locked brand ending pack.
 *
 * Every SunnyShutter commerce / acceptance video must end with this real ad
 * end card: logo + CTA + phone + address. Seedance never paints these.
 *
 * Visual: Image2-designed still under public/brand/ (see generate script);
 * typography for phone/address is burned exactly by the end-card renderer.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  resolveClientLockProfile,
  SUNNYSHUTTER_CLIENT_LOCK_ID,
  type ClientLockHints,
} from "@/lib/video-generation/client-lock-profiles";
import type { BrandPackagingPlan } from "@/types/video-generation";

/** CEO lock (2026-07-19): logo goes top-left on every SunnyShutter video — never bottom-right. */
export const SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT = "top-left" as const;

export type SunnyShutterLogoOverlayConfig = {
  enabled: boolean;
  placement: typeof SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT;
  opacity: number;
  logoWidthRatio: number;
  marginPx: number;
  durationMode: "full_video" | "first_3s" | "last_5s";
};

export const SUNNYSHUTTER_PHONE = "647-857-8669";
export const SUNNYSHUTTER_ADDRESS =
  "690 Progress Ave, Unit 7&8, Scarborough, ON";
export const SUNNYSHUTTER_ADDRESS_SHORT =
  "690 Progress Ave, Unit 7&8, Scarborough";

/** Local-only logo path (public/brand is gitignored; provide via Blob in prod). */
export const SUNNYSHUTTER_LOGO_RELATIVE = "public/brand/sunny-logo.png";
/**
 * Designed end-card backgrounds (tracked under assets/ — public/brand is gitignored).
 * Exact phone/address typography is burned at render time.
 */
export const SUNNYSHUTTER_END_CARD_STILL_9X16_RELATIVE =
  "assets/sunnyshutter/end-card-9x16.png";
export const SUNNYSHUTTER_END_CARD_STILL_16X9_RELATIVE =
  "assets/sunnyshutter/end-card-16x9.png";

export type SunnyShutterEndCardLanguage = "en" | "zh";

export type SunnyShutterLockedEndCardCopy = {
  language: SunnyShutterEndCardLanguage;
  brandName: string;
  slogan: string;
  cta: string;
  contactLines: string[];
  website: string | null;
  endCardDurationSeconds: number;
};

export const SUNNYSHUTTER_END_CARD_COPY: Record<
  SunnyShutterEndCardLanguage,
  SunnyShutterLockedEndCardCopy
> = {
  en: {
    language: "en",
    brandName: "SUNNY Shutters",
    slogan: "Custom Shutters · Measured, Made, Installed",
    cta: "Book Your FREE In-Home Quote",
    contactLines: [
      `Call / Text ${SUNNYSHUTTER_PHONE}`,
      SUNNYSHUTTER_ADDRESS,
    ],
    website: null,
    endCardDurationSeconds: 3,
  },
  zh: {
    language: "zh",
    brandName: "SUNNY 定制百叶窗",
    slogan: "上门量尺 · 工厂直供 · 专业安装",
    cta: "现在致电 免费上门量尺",
    contactLines: [`电话 ${SUNNYSHUTTER_PHONE}`, SUNNYSHUTTER_ADDRESS_SHORT],
    website: null,
    endCardDurationSeconds: 3,
  },
};

export function resolveSunnyShutterEndCardLanguage(hints?: {
  language?: string | null;
  brandName?: string | null;
  cta?: string | null;
}): SunnyShutterEndCardLanguage {
  const blob = [hints?.language, hints?.brandName, hints?.cta]
    .filter(Boolean)
    .join(" ");
  if (/[\u4e00-\u9fff]/.test(blob) || /\bzh\b/i.test(hints?.language ?? "")) {
    return "zh";
  }
  return "en";
}

export function sunnyShutterLogoFileUrl(cwd = process.cwd()): string {
  return pathToFileURL(path.resolve(cwd, SUNNYSHUTTER_LOGO_RELATIVE)).href;
}

export function sunnyShutterEndCardStillFileUrl(
  aspectRatio: string,
  cwd = process.cwd(),
): string {
  const relative =
    aspectRatio === "16:9"
      ? SUNNYSHUTTER_END_CARD_STILL_16X9_RELATIVE
      : SUNNYSHUTTER_END_CARD_STILL_9X16_RELATIVE;
  return pathToFileURL(path.resolve(cwd, relative)).href;
}

/** Locked watermark config for every SunnyShutter full-video logo overlay. */
export function sunnyShutterLogoOverlayConfig(overrides?: {
  opacity?: number;
  logoWidthRatio?: number;
  marginPx?: number;
  durationMode?: SunnyShutterLogoOverlayConfig["durationMode"];
}): SunnyShutterLogoOverlayConfig {
  return {
    enabled: true,
    placement: SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT,
    opacity: overrides?.opacity ?? 0.9,
    logoWidthRatio: overrides?.logoWidthRatio ?? 0.16,
    marginPx: overrides?.marginPx ?? 32,
    durationMode: overrides?.durationMode ?? "full_video",
  };
}

/**
 * Force logo corner to top-left for SunnyShutter; leave other clients unchanged.
 */
export function applySunnyShutterLogoOverlayLock<
  T extends {
    enabled?: boolean;
    placement?: string;
    opacity?: number;
    logoWidthRatio?: number;
    marginPx?: number;
    durationMode?: SunnyShutterLogoOverlayConfig["durationMode"];
  },
>(config: T | null | undefined, hints?: ClientLockHints): T | SunnyShutterLogoOverlayConfig | null {
  const profile = resolveClientLockProfile(hints ?? {});
  if (profile !== SUNNYSHUTTER_CLIENT_LOCK_ID) return config ?? null;
  return sunnyShutterLogoOverlayConfig({
    opacity: config?.opacity,
    logoWidthRatio: config?.logoWidthRatio,
    marginPx: config?.marginPx,
    durationMode: config?.durationMode,
  });
}

/**
 * Force SunnyShutter brand ending onto any packaging plan.
 * No-op for other clients.
 */
export function applySunnyShutterBrandPack(
  plan: BrandPackagingPlan,
  hints?: ClientLockHints & {
    language?: string | null;
    cta?: string | null;
    aspectRatio?: string | null;
  },
): BrandPackagingPlan {
  const profile = resolveClientLockProfile(hints ?? {});
  if (profile !== SUNNYSHUTTER_CLIENT_LOCK_ID) return plan;

  const language = resolveSunnyShutterEndCardLanguage({
    language: hints?.language,
    brandName: hints?.brandName ?? plan.brandName,
    cta: hints?.cta ?? plan.cta,
  });
  const copy = SUNNYSHUTTER_END_CARD_COPY[language];
  const aspect = hints?.aspectRatio ?? "9:16";

  return {
    ...plan,
    mode: "auto_end_card",
    brandName: copy.brandName,
    slogan: copy.slogan,
    cta: copy.cta,
    contactLines: [...copy.contactLines],
    website: copy.website,
    endCardDurationSeconds: copy.endCardDurationSeconds,
    hideCta: false,
    renderStrategy: "render_ffmpeg_overlay",
    /// Prefer Image2-designed still; renderer falls back to SVG if missing.
    endCardStillUrl: sunnyShutterEndCardStillFileUrl(aspect),
    logoOverlayPlacement: SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT,
    warnings: [
      ...(plan.warnings ?? []),
      "SunnyShutter brand end card locked (logo + phone + address).",
      "SunnyShutter logo watermark locked to top-left.",
    ],
  };
}

export function sunnyShutterEndCardMissingIssues(
  plan: BrandPackagingPlan,
): Array<{ code: string; message: string }> {
  const issues: Array<{ code: string; message: string }> = [];
  if (plan.mode === "none" || plan.endCardDurationSeconds <= 0) {
    issues.push({
      code: "sunnyshutter_end_card_required",
      message:
        "SunnyShutter videos must end with the locked brand end card (logo + phone + address).",
    });
    return issues;
  }
  const blob = (plan.contactLines ?? []).join(" ");
  if (!blob.includes(SUNNYSHUTTER_PHONE)) {
    issues.push({
      code: "sunnyshutter_end_card_missing_phone",
      message: `SunnyShutter end card must include phone ${SUNNYSHUTTER_PHONE}.`,
    });
  }
  if (!/690\s*Progress/i.test(blob)) {
    issues.push({
      code: "sunnyshutter_end_card_missing_address",
      message:
        "SunnyShutter end card must include 690 Progress Ave address line.",
    });
  }
  return issues;
}
