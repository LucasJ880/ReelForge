/**
 * SunnyShutter-only commerce batch template family.
 *
 * CEO style standard (2026-07-19 refs + chat):
 *   - More call-to-action (hard sell OK — 土土的没关系)
 *   - Product must not deform (geometry lock)
 *   - Narrative: 0-3s hook → conflict/contrast → return to product + locked end card
 *   - Style lanes from liked TikToks: cozy warm lifestyle, POV before/after,
 *     high-energy presenter hard-sell
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

/** CEO-approved style lanes (from Screen Recording refs + WeChat notes). */
export type SunnyShutterStyleLane =
  | "cozy_warm_lifestyle"
  | "pov_before_after"
  | "hard_sell_presenter"
  | "product_hero_proof";

const COMMERCE_FRAME = `GOAL LOCK: this is a sales / CTA ecommerce ad for SunnyShutter — not an artistic mood film. Every second must push a buying reason.
CEO STYLE STANDARD LOCK:
- Prefer direct hard-sell energy over tasteful slow cinema. "Cheesy / 土土的" sales pacing is ACCEPTABLE and preferred if it drives action.
- Maximize call-to-action intent in picture energy (urgency, problem→solution, book-a-quote vibe). Spoken lines may sell hard; NO on-screen text/captions/prices from the model (captions + end card are post).
- PRODUCT NO-DEFORM LOCK: plantation shutter louvers stay perfectly parallel; frames stay straight; hinge side and panel count match references; never warp wood, melt edges, or invent hardware.
NARRATIVE STRUCTURE LOCK (must follow this order):
1) 0-3s HOOK: one sharp attention problem or contrast tied to windows/light/privacy (no text on screen).
2) MIDDLE: escalate CONFLICT or STRONG CONTRAST / emotional resonance (uncomfortable before vs controlled after, or public glare vs private calm).
3) END: RETURN TO PRODUCT — clear hero view of the referenced plantation shutters as the solution; hold for the locked SunnyShutter real-ad end card (logo + phone + address burned in post — never by the model).
END-CARD LOCK: every SunnyShutter video MUST finish with the client end card (Call/Text 647-857-8669 · 690 Progress Ave Unit 7&8 Scarborough). Do not invent alternate contacts.
LOGO CORNER LOCK: full-video brand watermark is always top-left (never bottom-right). Logo is composited in post — model must not paint any logo.
CAMERA / LIGHT / RHYTHM LOCK: stable sales camera (medium/wide preferred, gentle push or hold only). Soft natural window daylight key OR warm amber lifestyle lamps when style lane says cozy; controlled fill; soft contact shadow on the sill. Sales pacing: hook beat → conflict/contrast beat → product hold.`;

const SHARED_NEGATIVE =
  "hand on tilt bar, fingers twisting louvers, broken tilt rod, jagged tilt bar, melting hands, warped louvers, bent shutter frames, uneven louver spacing, room geometry drift, product deformation, artistic slow-cinema mood with no sales beat, invented text, logos, captions, QR codes, prices, phone numbers, fake before/after CGI, curtain fabric motion, door morphing into shutters";

const STYLE_LANE_LOCK: Record<SunnyShutterStyleLane, string> = {
  cozy_warm_lifestyle:
    "STYLE LANE: cozy warm lifestyle (CEO ref). Warm amber lamp glow, textured neutrals, lived-in premium room; shutters are the hero upgrade — still end with hard CTA energy, not pure aesthetic.",
  pov_before_after:
    "STYLE LANE: POV before→after apartment transform (CEO ref). Wide empty/basic window first, then custom shutters reveal; handheld-authentic but stable; no on-screen POV text (spoken or post only).",
  hard_sell_presenter:
    "STYLE LANE: high-energy hard-sell presenter (CEO ref). Direct-to-camera, urgent sales body language, product large in frame; yellow-caption vibe is POST-ONLY — model paints no letters.",
  product_hero_proof:
    "STYLE LANE: product hero proof. Medium/wide shutter wall dominates; geometry razor-stable; one clear benefit beat then CTA hold.",
};

export type SunnyShutterCommercePlotVariant = {
  id: string;
  slug: string;
  name: string;
  nameZh: string;
  motion: ShotMotion;
  styleLane: SunnyShutterStyleLane;
  /** Sales conflict angle for this variant (agent may expand wording, not structure). */
  conflictAngle: string;
  beats: string[];
};

/**
 * Fixed plot + style templates. Batch of 10+ rotates these.
 * Structure / motion / no-deform / end-card stay locked; lane varies the look.
 */
export const SUNNYSHUTTER_COMMERCE_PLOT_VARIANTS: readonly SunnyShutterCommercePlotVariant[] =
  [
    {
      id: "glare-vs-control",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-glare`,
      name: "SunnyShutter CTA · Glare Control",
      nameZh: "SunnyShutter 带货 · 刺眼日光对比",
      motion: "louver_tilt_no_hands",
      styleLane: "product_hero_proof",
      conflictAngle: "harsh morning glare vs soft controlled daylight",
      beats: [
        "0-3s HOOK: wide room, harsh glare blasting through open louvers — viewer feels the discomfort (no hands).",
        "3-10s CONFLICT/CONTRAST: all louvers tilt together slowly as one unit to kill the glare; light on the floor softens (no hands in frame).",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: medium/wide hero of the exact referenced white plantation shutters; urgent sales hold for end card.",
      ],
    },
    {
      id: "privacy-vs-exposure",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-privacy`,
      name: "SunnyShutter CTA · Privacy Contrast",
      nameZh: "SunnyShutter 带货 · 隐私对比",
      motion: "panel_hinge_open",
      styleLane: "product_hero_proof",
      conflictAngle: "street exposure vs private closed panels",
      beats: [
        "0-3s HOOK: street/building visible through open shutter panels — privacy feels exposed.",
        "3-10s CONFLICT/CONTRAST: exactly one whole panel slowly swings closed on side hinges like a door, reclaiming privacy (no hand on tilt bar).",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: hero hold on the closed referenced shutter wall; clear buy-signal hold.",
      ],
    },
    {
      id: "draft-vs-sealed",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-comfort`,
      name: "SunnyShutter CTA · Comfort Seal",
      nameZh: "SunnyShutter 带货 · 舒适封闭",
      motion: "static_product",
      styleLane: "product_hero_proof",
      conflictAngle: "thin flimsy window covering feel vs solid custom shutter presence",
      beats: [
        "0-3s HOOK: cold empty window feeling — room looks unfinished / drafty near the glass.",
        "3-10s CONFLICT/RESONANCE: cut to the exact referenced solid plantation shutters filling the opening; camera gentle push only; shutters stay static; geometry never warps.",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: clean three-quarter product hero; premium solid build sells the upgrade.",
      ],
    },
    {
      id: "view-on-demand",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-view`,
      name: "SunnyShutter CTA · View On Demand",
      nameZh: "SunnyShutter 带货 · 随时开景",
      motion: "panel_hinge_open",
      styleLane: "product_hero_proof",
      conflictAngle: "blocked view vs open scenic reveal",
      beats: [
        "0-3s HOOK: closed shutter wall — view is blocked, room feels closed-in.",
        "3-10s CONFLICT/CONTRAST: one whole panel swings open on hinges to reveal the outdoor view (door-like panel motion only).",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: hold on the open panel + remaining shutter frames matching references.",
      ],
    },
    {
      id: "presenter-point-sale",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-presenter`,
      name: "SunnyShutter CTA · Presenter Point",
      nameZh: "SunnyShutter 带货 · 顾问指景",
      motion: "presenter_point_only",
      styleLane: "hard_sell_presenter",
      conflictAngle: "confused DIY options vs clear custom shutter recommendation",
      beats: [
        "0-3s HOOK: presenter faces camera beside the shutter wall with urgent hard-sell energy — wrong window covering is the problem.",
        "3-10s CONFLICT/RESONANCE: she points at the referenced shutters (never touches tilt bar/louvers) while selling light + privacy control.",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: camera favors the shutter hero; presenter steps aside; product fills frame for end-card CTA.",
      ],
    },
    {
      id: "cozy-warm-upgrade",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-cozy`,
      name: "SunnyShutter CTA · Cozy Warm Upgrade",
      nameZh: "SunnyShutter 带货 · 暖光治愈升级",
      motion: "static_product",
      styleLane: "cozy_warm_lifestyle",
      conflictAngle: "cold unfinished window vs warm cozy room with custom shutters",
      beats: [
        "0-3s HOOK: cool empty window corner feels incomplete — not cozy yet.",
        "3-10s CONFLICT/RESONANCE: warm amber lamp glow fills the room; exact referenced plantation shutters sit on the window as the finished upgrade; shutters static; textures soft and lived-in.",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: medium hero of shutters in the cozy room; sales urgency under the warm look — book the free quote vibe.",
      ],
    },
    {
      id: "pov-before-after",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-pov-ba`,
      name: "SunnyShutter CTA · POV Before After",
      nameZh: "SunnyShutter 带货 · POV 前后对比",
      motion: "static_product",
      styleLane: "pov_before_after",
      conflictAngle: "empty apartment / basic blinds before vs custom shutters after",
      beats: [
        "0-3s HOOK: wide POV of a plain empty room with a basic bare or cheap-looking window — before moving-in energy.",
        "3-10s CONFLICT/CONTRAST: hard cut / match-angle after — same room now finished with the exact referenced plantation shutters; geometry locked; no warp.",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: push-in on the shutter wall as the transformation proof; hard CTA hold.",
      ],
    },
    {
      id: "hard-sell-host",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-hard-sell`,
      name: "SunnyShutter CTA · Hard-Sell Host",
      nameZh: "SunnyShutter 带货 · 硬广主持人",
      motion: "presenter_point_only",
      styleLane: "hard_sell_presenter",
      conflictAngle: "renter blinds / DIY mess vs factory-custom shutters you can book today",
      beats: [
        "0-3s HOOK: energetic presenter mid-gesture beside the shutter wall, direct to camera, loud sales opener energy (cheesy OK).",
        "3-10s DEMO: points hard at the referenced shutters (never touches tilt bar); one whole benefit — custom fit, light control, privacy — spoken urgency.",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: product fills frame; presenter exits or stays edge; freeze-ready for phone/address end card.",
      ],
    },
    {
      id: "night-privacy-cozy",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-night-privacy`,
      name: "SunnyShutter CTA · Night Privacy Cozy",
      nameZh: "SunnyShutter 带货 · 夜间隐私暖光",
      motion: "panel_hinge_open",
      styleLane: "cozy_warm_lifestyle",
      conflictAngle: "street lights / neighbors at night vs closed warm private room",
      beats: [
        "0-3s HOOK: night window with open panels — street glow / exposure discomfort.",
        "3-10s CONFLICT/CONTRAST: one whole panel slowly swings closed on hinges; warm interior lamps take over; private cozy room.",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: closed shutter wall hero matching references; CTA hold.",
      ],
    },
    {
      id: "geometry-hero-proof",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-geometry`,
      name: "SunnyShutter CTA · Geometry Hero",
      nameZh: "SunnyShutter 带货 · 产品不变形特写",
      motion: "static_product",
      styleLane: "product_hero_proof",
      conflictAngle: "cheap wavy blinds stigma vs crisp parallel custom louvers",
      beats: [
        "0-3s HOOK: medium/wide of the referenced shutter wall — sell crisp parallel louvers and straight frames (no macro warp).",
        "3-10s PROOF: gentle camera push only; shutters stay 100% static; every louver stays evenly spaced and undeformed.",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: three-quarter hero hold; hard CTA energy for free in-home quote.",
      ],
    },
    {
      id: "morning-routine-sell",
      slug: `${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-morning`,
      name: "SunnyShutter CTA · Morning Routine Sell",
      nameZh: "SunnyShutter 带货 · 晨光日常带货",
      motion: "louver_tilt_no_hands",
      styleLane: "cozy_warm_lifestyle",
      conflictAngle: "wake-up glare ruining mornings vs one tilt of controlled daylight",
      beats: [
        "0-3s HOOK: harsh morning stripes across bed/floor — glare pain point.",
        "3-10s CONFLICT/CONTRAST: all louvers tilt together slowly as one unit (no hands); light softens into warm usable daylight.",
        "10-15s RETURN TO PRODUCT + CTA ENERGY: shutter hero matching references; sell 'book your free measure' energy.",
      ],
    },
  ];

function buildSkeleton(variant: SunnyShutterCommercePlotVariant): string {
  const safeCore = renderSafeShutterPrompt({
    motion: variant.motion,
    productName: "{PRODUCT_NAME}",
    beats: variant.beats,
    productLock:
      "CLIENT LOCK: sunnyshutter. Use only the supplied product reference images as multi-angle visual truth for the plantation shutters. Preserve louver width, frame color, panel layout, hinge side, material and proportions. Never invent an unseen side or feature; Never redesign. PRODUCT NO-DEFORM: louvers stay parallel; frames stay straight; no melted wood.",
    voiceLock:
      variant.styleLane === "hard_sell_presenter"
        ? "Hard-sell spoken energy if audio is generated: urgent, clear Canadian English, slightly cheesy salesperson OK; quiet room; NO music bed (BGM added in post)."
        : "Sales voice energy in ambient only if audio is generated: clear, urgent-but-warm Canadian English; quiet room; NO music bed (BGM added in post).",
    microExpressionLock:
      variant.motion === "presenter_point_only"
        ? "high-energy sales face OK (CEO hard-sell ref); eyes on camera; never exaggerated cartoon faces"
        : "no faces required; keep product geometry stable and undeformed",
    aspectHint:
      "9:16 vertical SunnyShutter ecommerce sales ad (CTA). Photorealistic real-footage look.",
  });

  return [
    COMMERCE_FRAME,
    STYLE_LANE_LOCK[variant.styleLane],
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
    version: 2,
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
      cameraStyle:
        variant.styleLane === "pov_before_after"
          ? "authentic wide apartment POV, stable enough to protect shutter geometry"
          : variant.styleLane === "hard_sell_presenter"
            ? "energetic sales gimbal, medium/wide, product large in frame"
            : "stable sales gimbal, medium/wide preferred",
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

export function listSunnyShutterStyleLanes(): SunnyShutterStyleLane[] {
  return [
    "cozy_warm_lifestyle",
    "pov_before_after",
    "hard_sell_presenter",
    "product_hero_proof",
  ];
}
