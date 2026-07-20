/**
 * SunnyShutter-only commerce batch template family.
 *
 * Locks CEO/peer narrative structure for sales ads (not artistic films):
 *   0-3s hook → mid conflict / strong contrast / resonance → return to product.
 * Safe ShotMotion only; client lock profile = sunnyshutter.
 *
 * Spec: docs/acceptance/shutter-safe-shot-policy.md
 */

import type { BatchStyleTemplateSeed } from "@/lib/video-generation/batch-style-templates";
import { SUNNYSHUTTER_CLIENT_LOCK_ID } from "@/lib/video-generation/client-lock-profiles";
import {
  type ShotMotion,
  renderSafeShutterPrompt,
} from "@/lib/video-generation/shutter-shot-policy";

export const SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY =
  "sunnyshutter-commerce-cta" as const;

export const SUNNYSHUTTER_COMMERCE_CLIENT_LOCK = SUNNYSHUTTER_CLIENT_LOCK_ID;

const COMMERCE_FRAME = `GOAL LOCK: this is a sales / CTA ecommerce ad for SunnyShutter — not an artistic mood film. Every second must push a buying reason.
NARRATIVE STRUCTURE LOCK (must follow this order):
1) 0-3s HOOK: one sharp attention problem or contrast tied to windows/light/privacy (no text on screen).
2) MIDDLE: escalate CONFLICT or STRONG CONTRAST / emotional resonance (uncomfortable before vs controlled after, or public glare vs private calm).
3) END: RETURN TO PRODUCT — clear hero view of the referenced plantation shutters as the solution; hold for CTA packaging (logo/phone added in post, never by the model).
CAMERA / LIGHT / RHYTHM LOCK: stable sales camera (medium/wide preferred, gentle push or hold only). Soft natural window daylight key, controlled fill, soft contact shadow on the sill. Sales pacing: hook beat → conflict/contrast beat → product hold.`;

const SHARED_NEGATIVE =
  "hand on tilt bar, fingers twisting louvers, broken tilt rod, jagged tilt bar, melting hands, warped louvers, room geometry drift, artistic slow-cinema mood with no sales beat, invented text, logos, captions, QR codes, prices, phone numbers, fake before/after CGI, curtain fabric motion, door morphing into shutters";

export type SunnyShutterCommercePlotVariant = {
  id: string;
  slug: string;
  name: string;
  nameZh: string;
  motion: ShotMotion;
  /** Sales conflict angle for this variant (agent may expand wording, not structure). */
  conflictAngle: string;
  beats: string[];
};

/**
 * Fixed plot templates. Batch of 10 rotates these; wording can vary slightly via
 * product name / rooms in references, but structure + motion stay locked.
 */
export const SUNNYSHUTTER_COMMERCE_PLOT_VARIANTS: readonly SunnyShutterCommercePlotVariant[] =
  [
    {
      id: "glare-vs-control",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-glare`,
      name: "SunnyShutter CTA · Glare Control",
      nameZh: "SunnyShutter 带货 · 刺眼日光对比",
      motion: "louver_tilt_no_hands",
      conflictAngle: "harsh morning glare vs soft controlled daylight",
      beats: [
        "0-3s HOOK: wide room, harsh glare blasting through open louvers — viewer feels the discomfort (no hands).",
        "3-10s CONFLICT/CONTRAST: all louvers tilt together slowly as one unit to kill the glare; light on the floor softens (no hands in frame).",
        "10-15s RETURN TO PRODUCT: medium/wide hero of the exact referenced white plantation shutters as the solution; calm hold for CTA.",
      ],
    },
    {
      id: "privacy-vs-exposure",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-privacy`,
      name: "SunnyShutter CTA · Privacy Contrast",
      nameZh: "SunnyShutter 带货 · 隐私对比",
      motion: "panel_hinge_open",
      conflictAngle: "street exposure vs private closed panels",
      beats: [
        "0-3s HOOK: street/building visible through open shutter panels — privacy feels exposed.",
        "3-10s CONFLICT/CONTRAST: exactly one whole panel slowly swings closed on side hinges like a door, reclaiming privacy (no hand on tilt bar).",
        "10-15s RETURN TO PRODUCT: hero hold on the closed referenced shutter wall; product is the clear answer.",
      ],
    },
    {
      id: "draft-vs-sealed",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-comfort`,
      name: "SunnyShutter CTA · Comfort Seal",
      nameZh: "SunnyShutter 带货 · 舒适封闭",
      motion: "static_product",
      conflictAngle: "thin flimsy window covering feel vs solid custom shutter presence",
      beats: [
        "0-3s HOOK: cold empty window feeling — room looks unfinished / drafty near the glass.",
        "3-10s CONFLICT/RESONANCE: cut to the exact referenced solid plantation shutters filling the opening; camera gentle push only; shutters stay static.",
        "10-15s RETURN TO PRODUCT: clean three-quarter product hero; premium solid build reads as the upgrade.",
      ],
    },
    {
      id: "view-on-demand",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-view`,
      name: "SunnyShutter CTA · View On Demand",
      nameZh: "SunnyShutter 带货 · 随时开景",
      motion: "panel_hinge_open",
      conflictAngle: "blocked view vs open scenic reveal",
      beats: [
        "0-3s HOOK: closed shutter wall — view is blocked, room feels closed-in.",
        "3-10s CONFLICT/CONTRAST: one whole panel swings open on hinges to reveal the outdoor view (door-like panel motion only).",
        "10-15s RETURN TO PRODUCT: hold on the open panel + remaining shutter frames matching references; product enables the view.",
      ],
    },
    {
      id: "presenter-point-sale",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-presenter`,
      name: "SunnyShutter CTA · Presenter Point",
      nameZh: "SunnyShutter 带货 · 顾问指景",
      motion: "presenter_point_only",
      conflictAngle: "confused DIY options vs clear custom shutter recommendation",
      beats: [
        "0-3s HOOK: presenter faces camera beside the shutter wall with urgent sales energy — problem is wrong window covering.",
        "3-10s CONFLICT/RESONANCE: she points at the referenced shutters (never touches tilt bar/louvers) while the room shows controlled light.",
        "10-15s RETURN TO PRODUCT: camera favors the shutter hero; presenter steps aside; product fills frame for CTA hold.",
      ],
    },
  ];

function buildSkeleton(variant: SunnyShutterCommercePlotVariant): string {
  const safeCore = renderSafeShutterPrompt({
    motion: variant.motion,
    productName: "{PRODUCT_NAME}",
    beats: variant.beats,
    productLock:
      "CLIENT LOCK: sunnyshutter. Use only the supplied product reference images as multi-angle visual truth for the plantation shutters. Preserve louver width, frame color, panel layout, hinge side, material and proportions. Never invent an unseen side or feature; Never redesign.",
    voiceLock:
      "Sales voice energy in ambient only if audio is generated: clear, urgent-but-warm Canadian English; quiet room; NO music bed (BGM added in post).",
    microExpressionLock:
      variant.motion === "presenter_point_only"
        ? "confident slight smile, focused eyes on camera, no exaggerated faces"
        : "no faces required; keep product geometry stable",
    aspectHint:
      "9:16 vertical SunnyShutter ecommerce sales ad (CTA). Photorealistic real-footage look.",
  });

  return [
    COMMERCE_FRAME,
    `CONFLICT ANGLE LOCK: ${variant.conflictAngle}.`,
    "",
    safeCore,
    "",
    "References: {IMAGE_REFS}.",
  ].join("\n");
}

export function sunnyshutterCommerceTemplateSeed(
  variant: SunnyShutterCommercePlotVariant,
): BatchStyleTemplateSeed {
  return {
    slug: variant.slug,
    version: 1,
    name: variant.name,
    nameZh: variant.nameZh,
    category: "SunnyShutter电商",
    coverImage: "/template-previews/before-after-reversal.jpg",
    promptSkeleton: buildSkeleton(variant),
    negativePrompt: SHARED_NEGATIVE,
    lockedParams: {
      duration: 15,
      aspectRatio: "9:16",
      resolution: "1080p",
      cameraStyle: "stable sales gimbal, medium/wide preferred",
      stability: "high",
      humanInteraction:
        variant.motion === "presenter_point_only" ? "controlled" : "none",
    },
    imagesPerVideo: { min: 2, max: 4 },
  };
}

export const SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS: BatchStyleTemplateSeed[] =
  SUNNYSHUTTER_COMMERCE_PLOT_VARIANTS.map(sunnyshutterCommerceTemplateSeed);

/** Deterministic rotation for a 10-video batch (or any count). */
export function pickSunnyShutterCommerceVariant(
  index1Based: number,
): SunnyShutterCommercePlotVariant {
  const i = Math.max(1, Math.floor(index1Based));
  const variants = SUNNYSHUTTER_COMMERCE_PLOT_VARIANTS;
  return variants[(i - 1) % variants.length]!;
}

export function isSunnyShutterCommerceTemplateSlug(slug: string): boolean {
  return (
    slug === SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY ||
    slug.startsWith(`${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-`)
  );
}
