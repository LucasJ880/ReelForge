import type { Prisma } from "@prisma/client";
import { planSegments, type SupportedDurationSec } from "../../src/lib/duration/segment-planner";
import { DIRECTOR_PROMPT_VERSION, type DirectorPlan } from "../../src/lib/schemas/director-plan";
import { safeAreaNotesFor } from "../../src/lib/video-generation/platform-safe-zone";

/**
 * 测试夹具：按段位造一份合法的 DirectorPlan（多段出片 / 重试 / 计费这些测试拿它当 brief.directorPlan）。
 * 原先住在 src/lib/services/director-service.ts（旧的整条「AI 导演」服务，2026-11-16 删除，没有任何源码引用），
 * 只有这个造数据的函数还被测试用着，原样搬到这里。严格遵循 segmentSlots 的段数和时长。
 */
export interface DirectorPlanFixtureContext {
  targetDurationSec: SupportedDurationSec;
  segmentSlots: ReturnType<typeof planSegments>;
  clientBrief: Prisma.JsonValue;
  productInput: Prisma.JsonValue;
  targetCountry: string;
  targetLanguage: string;
  targetPlatform: string;
  angle: {
    title: string;
    hook: string | null;
    narrative: string | null;
    type: string;
    explorationTheme: string | null;
    localeNotes: Record<string, unknown> | null;
  };
}

export function mockDirectorPlan(ctx: DirectorPlanFixtureContext): DirectorPlan {
  const productName = readClientBriefProductName(ctx.clientBrief) ?? ctx.angle.title;
  const language = ctx.targetLanguage || "en-US";

  const timelineScript = ctx.segmentSlots.flatMap((slot) => {
    const start = slot.segmentIndex * 15;
    return [
      {
        fromSec: start,
        toSec: start + 2,
        visual: `Hook for segment ${slot.segmentIndex}: a tight close-up of ${productName} catching warm window light.`,
        cameraMovement: "slow dolly-in",
        onScreenText: slot.segmentIndex === 0 ? `Tap to see how ${productName} works` : "",
        voiceover: ctx.angle.hook ?? `Meet ${productName}.`,
        musicCue: "soft upbeat indie loop",
        assetNeeded: "AI-generated",
        hasFootage: false,
        seedanceShotPrompt: `Close-up of ${productName} in a sunlit modern living room, 9:16 vertical, cinematic, soft warm color grade`,
      },
      {
        fromSec: start + 2,
        toSec: start + slot.durationSec,
        visual: `Demonstration of ${productName} in real use, hands of a real person interacting smoothly.`,
        cameraMovement: "handheld over-the-shoulder",
        onScreenText: slot.role === "cta" ? "Order now — link in bio" : "",
        voiceover:
          slot.role === "cta"
            ? ctx.angle.narrative ?? `Try ${productName} risk-free for 30 days.`
            : `${productName} fits effortlessly into your day.`,
        musicCue: "indie loop continues",
        assetNeeded: "AI-generated",
        hasFootage: false,
        seedanceShotPrompt: `${productName} being used naturally by a real person, 9:16 vertical, no on-screen text artifacts`,
      },
    ];
  });

  const segmentPlan = ctx.segmentSlots.map((slot) => ({
    segmentIndex: slot.segmentIndex,
    durationSec: slot.durationSec,
    fromSec: slot.segmentIndex * 15,
    toSec: slot.segmentIndex * 15 + slot.durationSec,
    role: slot.role,
    seedancePrompt: `Vertical 9:16 cinematic shot of ${productName} (${slot.role} segment). ${
      slot.role === "hook"
        ? "Open with a strong visual grab."
        : slot.role === "cta"
          ? "Close with end card and CTA energy."
          : "Show the product clearly in use."
    } Soft warm light, real-life setting, no text artifacts.`,
    negativePrompt: "low quality, blurry, distorted text, watermark, deformed hands",
    continuityNotes:
      slot.segmentIndex === 0
        ? "Establish the look and tone."
        : `Continue the look from segment ${slot.segmentIndex - 1}: same lighting, same setting, same hands.`,
    referenceAssetHints: [],
    expectedOutput: `15-second 9:16 clip showing ${productName} in a ${slot.role} moment.`,
  }));

  return {
    version: DIRECTOR_PROMPT_VERSION,
    language,
    targetDurationSec: ctx.targetDurationSec,
    platform: ctx.targetPlatform || "tiktok",
    strategySummary: {
      targetAudience: "Homeowners aged 30–55 who care about comfort and convenience.",
      corePainPoint: "Daily routines feel cluttered — they want one less thing to manage.",
      emotionalAngle: "Calm, in-control, modern home life.",
      keySellingPoints: [
        `${productName} sets up in minutes`,
        `${productName} works hands-free`,
      ],
      platformFit: "Vertical 9:16, fast hook in first 2 seconds, hands-on demo, mobile-friendly captions.",
      recommendedDurationReason: `${ctx.targetDurationSec}s is enough to land the hook, demo, and CTA without losing attention.`,
    },
    timelineScript,
    segmentPlan,
    editingPlan: {
      stitchOrder: ctx.segmentSlots.map((s) => s.segmentIndex),
      transitions: ctx.segmentSlots.length > 1 ? ["match-cut on motion"] : [],
      captions: "Lower-third bold sans-serif, white with black drop shadow.",
      logoPlacement: readClientBriefLogoUrl(ctx.clientBrief)
        ? "bottom-right corner from second 1, plus end card"
        : "logo to be added later",
      ctaEndCard: "End card: product name + 'Tap to learn more'",
      backgroundMusic: "Soft modern indie loop at -14 LUFS.",
      voiceoverAlignment: "Voiceover aligned with on-screen actions, no overlap with captions.",
      safeAreaNotes: safeAreaNotesFor(ctx.targetPlatform),
    },
    qualityChecklist: [
      "First 2 seconds is a visual moment (no tagline-only opening)",
      "CTA is concrete (specific verb + offer)",
      "No filler adjectives like amazing/revolutionary/premium",
      "Logo placement specified",
    ],
  };
}

function readClientBriefProductName(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.productName === "string") return obj.productName;
  if (typeof obj.businessName === "string") return obj.businessName;
  return null;
}

function readClientBriefLogoUrl(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const brand = obj.brandAssets;
  if (!brand || typeof brand !== "object" || Array.isArray(brand)) return null;
  const logo = (brand as Record<string, unknown>).logoUrl;
  return typeof logo === "string" ? logo : null;
}
