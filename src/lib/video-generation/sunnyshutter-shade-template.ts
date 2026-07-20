/**
 * SunnyShutter shade / curtain commerce templates (English-primary sales ads).
 *
 * Lessons from shutter batch + peer blackout-shade 15s + CEO WeChat notes:
 *   - Same person + same room across the whole 15s (consistency first)
 *   - Sales CTA energy (hard-sell OK), not artsy mood film
 *   - Pull beads / continuous loop chain HARD-LOCKED to LEFT or RIGHT edge only
 *   - Brand logo + contact burned in post, never by the model
 *
 * Plan A mix for batch10: ~6 roller + 2 zebra + 2 sheer.
 */

export const SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY =
  "sunnyshutter-shade-cta" as const;

export type ShadeProductKind = "roller_blackout" | "zebra" | "sheer_sfold";

export type ShadePullSide = "left" | "right";

export type SunnyShutterShadePlotVariant = {
  id: string;
  slug: string;
  name: string;
  nameZh: string;
  productKind: ShadeProductKind;
  pullSide: ShadePullSide;
  conflictAngle: string;
  /** English sales beats — model + storyboard must follow this order. */
  beats: string[];
  /** Character lock: peer-quality path uses one consistent woman; some SKUs are product-hero only. */
  characterMode: "same_woman" | "product_only";
};

const MECHANICS_LOCK = `PRODUCT MECHANICS HARD LOCK (CEO / WeChat — MUST OBEY):
- If a beaded pull chain / continuous loop cord is visible, it MUST sit only on the far LEFT edge OR far RIGHT edge of the shade cassette/headrail.
- NEVER place the pull chain in the center, floating mid-window, or away from the side rail.
- Roller fabric stays flat and rectangular; zebra bands stay evenly spaced horizontal stripes; sheer S-fold / ripple-fold waves stay uniform top-to-bottom.
- Headrail / cassette stays straight; no melted fabric, no warped window frames.
- Match the supplied product reference photos for color, opacity, and mount style.`;

const SALES_FRAME = `GOAL LOCK: English-primary SunnyShutter ecommerce SALES ad for window shades/curtains — hard CTA energy (cheesy OK if it sells).
NARRATIVE LOCK (peer blackout-shade quality bar):
1) 0-3s HOOK — sharp light/privacy/sleep pain (viewer feels discomfort).
2) MIDDLE — operate the shade correctly (side pull only) OR show clear before→after light control.
3) END — product hero + calm comfort payoff; hold for locked SunnyShutter business-card end card (logo + phone + address burned in post).
CONSISTENCY LOCK: same room, same window, same product, same person (if any) for the entire 15 seconds — no character/room drift.
SINGLE-SCENE ANTI-GHOST LOCK (CEO): ONE room, ONE window, ONE locked camera setup for the whole video. Never change rooms mid-video. NO crossfade, NO dissolve, NO double exposure, NO translucent ghost overlays, NO morphing between spaces — beats progress only through real motion inside the same shot (shade moving, person moving); a clean hard cut is the only allowed transition.
WINDOW PROTAGONIST LOCK (CEO): the window + SunnyShutter covering is the hero of every shot — keep the SAME window large and clearly visible in frame at all times; the person supports the story but never replaces the window as the subject.
NO MODEL TEXT / NO FAKE END CARD (HARD):
- Do NOT paint any logo, brand name, captions, subtitles, prices, phone numbers, WhatsApp icons, website URLs, QR codes, or contact cards.
- Do NOT invent a white business-card popup, cursive "Sunny Shutter" watermark, or garbled contact digits at the end.
- End branding is added in post — the model must finish on a clean product / lifestyle hold with ZERO on-screen text.
LOGO CORNER LOCK: watermark is post top-left only — keep the TOP-LEFT corner of the picture clean and unobstructed (no marks, no bright objects hugging that corner) so the composited logo never overlaps model-drawn content.`;

export const SUNNYSHUTTER_SHADE_PLOT_VARIANTS: readonly SunnyShutterShadePlotVariant[] =
  [
    // —— 6× roller ——
    {
      id: "roller-glare-wake",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-roller-glare`,
      name: "SunnyShutter Shade · Morning Glare Roller",
      nameZh: "卷帘 · 晨光刺眼",
      productKind: "roller_blackout",
      pullSide: "right",
      characterMode: "same_woman",
      conflictAngle: "harsh morning glare waking you up vs blackout calm",
      beats: [
        "0-3s HOOK: same young East-Asian woman in bed squints / shields eyes from harsh window glare (same bedroom throughout).",
        "3-10s SOLUTION: she sits up and pulls the continuous beaded chain on the RIGHT edge only; light-gray/white roller shade lowers smoothly; room darkens.",
        "10-15s PAYOFF + CTA ENERGY: shade fully down, soft dark room, she rests peacefully; hero hold of the roller shade matching references.",
      ],
    },
    {
      id: "roller-sleep-blackout",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-roller-sleep`,
      name: "SunnyShutter Shade · Sleep Blackout",
      nameZh: "卷帘 · 遮光睡眠",
      productKind: "roller_blackout",
      pullSide: "left",
      characterMode: "same_woman",
      conflictAngle: "bright condo light stealing sleep vs true blackout",
      beats: [
        "0-3s HOOK: bright daylight floods the bedroom; same woman looks exhausted from light leak.",
        "3-10s SOLUTION: LEFT-edge beaded chain only — shade drops; room goes nearly black (blackout proof).",
        "10-15s PAYOFF: peaceful sleep / soft smile on pillow; product hero of fully closed roller shade.",
      ],
    },
    {
      id: "roller-condo-privacy",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-roller-privacy`,
      name: "SunnyShutter Shade · Condo Privacy",
      nameZh: "卷帘 · 公寓隐私",
      productKind: "roller_blackout",
      pullSide: "right",
      characterMode: "same_woman",
      conflictAngle: "neighbors / street can see in vs private closed shade",
      beats: [
        "0-3s HOOK: open glass exposes interior to outside buildings — privacy feels unsafe.",
        "3-10s SOLUTION: woman pulls RIGHT-side chain; opaque roller covers glass; exterior vanishes.",
        "10-15s PAYOFF: private modern room; sales hero hold of the closed shade matching refs.",
      ],
    },
    {
      id: "roller-office-glare",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-roller-office`,
      name: "SunnyShutter Shade · Desk Glare Control",
      nameZh: "卷帘 · 办公防眩",
      productKind: "roller_blackout",
      pullSide: "left",
      characterMode: "product_only",
      conflictAngle: "screen glare from floor-to-ceiling glass vs soft diffused work light",
      beats: [
        "0-3s HOOK: harsh window light blasting a desk / laptop area (no face needed).",
        "3-10s SOLUTION: LEFT-edge chain; white light-filtering roller lowers to cut glare while keeping a bright work room.",
        "10-15s PAYOFF: clean modern office/condo hero of roller shades matching product photos; hard CTA energy.",
      ],
    },
    {
      id: "roller-living-filter",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-roller-living`,
      name: "SunnyShutter Shade · Living Room Soft Light",
      nameZh: "卷帘 · 客厅柔光",
      productKind: "roller_blackout",
      pullSide: "right",
      characterMode: "product_only",
      conflictAngle: "harsh direct sun on sofa vs soft filtered daylight",
      beats: [
        "0-3s HOOK: hot bright bands across living room sofa / floor.",
        "3-10s SOLUTION: RIGHT-edge chain; ivory roller lowers partway — light softens, city view still peeking under hem.",
        "10-15s PAYOFF: premium living-room product hero matching references; book-a-quote energy.",
      ],
    },
    {
      id: "roller-corner-windows",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-roller-corner`,
      name: "SunnyShutter Shade · Corner Glass Control",
      nameZh: "卷帘 · 转角落地窗",
      productKind: "roller_blackout",
      pullSide: "left",
      characterMode: "product_only",
      conflictAngle: "overexposed corner glass walls vs controlled roller coverage",
      beats: [
        "0-3s HOOK: bright corner floor-to-ceiling windows feel exposed / too bright.",
        "3-10s SOLUTION: rollers on corner windows adjust via LEFT-edge chains only; fabric stays flat rectangles.",
        "10-15s PAYOFF: architectural product hero matching refs; urgent sales hold.",
      ],
    },
    // —— 2× zebra ——
    {
      id: "zebra-day-privacy",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-zebra-day`,
      name: "SunnyShutter Shade · Zebra Day Privacy",
      nameZh: "斑马帘 · 白天隐私",
      productKind: "zebra",
      pullSide: "right",
      characterMode: "product_only",
      conflictAngle: "see-through exposure vs zebra stripe privacy without killing daylight",
      beats: [
        "0-3s HOOK: too-open window; street/yard too visible.",
        "3-10s SOLUTION: RIGHT-edge chain; zebra dual shade shifts bands — view softens, light remains.",
        "10-15s PAYOFF: crisp even zebra stripes hero matching refs; CTA energy.",
      ],
    },
    {
      id: "zebra-kitchen-light",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-zebra-kitchen`,
      name: "SunnyShutter Shade · Kitchen Zebra Light",
      nameZh: "斑马帘 · 厨房采光",
      productKind: "zebra",
      pullSide: "left",
      characterMode: "product_only",
      conflictAngle: "kitchen glare vs soft striped daylight over sink",
      beats: [
        "0-3s HOOK: harsh kitchen window glare on counters.",
        "3-10s SOLUTION: LEFT-edge chain; white zebra shades adjust; soft bands of light, backyard still readable.",
        "10-15s PAYOFF: clean kitchen product hero; hard-sell free measure vibe.",
      ],
    },
    // —— 2× sheer S-fold ——
    {
      id: "sheer-airy-living",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-sheer-living`,
      name: "SunnyShutter Shade · Sheer S-Fold Living",
      nameZh: "纱帘 · 客厅 S 褶",
      productKind: "sheer_sfold",
      pullSide: "right",
      characterMode: "product_only",
      conflictAngle: "bare glass looks unfinished vs elegant ripple-fold sheers",
      beats: [
        "0-3s HOOK: empty tall glass feels cold / unfinished.",
        "3-10s SOLUTION: white S-fold / ripple-fold sheers glide on slim dark ceiling track; uniform waves; soft daylight.",
        "10-15s PAYOFF: premium sheer wall hero matching refs; sales CTA hold.",
      ],
    },
    {
      id: "sheer-condo-glow",
      slug: `${SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY}-sheer-glow`,
      name: "SunnyShutter Shade · Sheer Condo Glow",
      nameZh: "纱帘 · 公寓柔光",
      productKind: "sheer_sfold",
      pullSide: "left",
      characterMode: "product_only",
      conflictAngle: "harsh condo light vs soft glowing sheer elegance",
      beats: [
        "0-3s HOOK: bright raw window light feels harsh in a modern condo.",
        "3-10s SOLUTION: floor-to-ceiling white sheers settle into even S-folds; light becomes soft glow.",
        "10-15s PAYOFF: airy luxury sheer hero; book free in-home quote energy.",
      ],
    },
  ];

export function pickSunnyShutterShadeVariant(
  index1Based: number,
): SunnyShutterShadePlotVariant {
  const i = Math.max(1, Math.floor(index1Based));
  const variants = SUNNYSHUTTER_SHADE_PLOT_VARIANTS;
  return variants[(i - 1) % variants.length]!;
}

export function buildSunnyShutterShadePrompt(args: {
  variant: SunnyShutterShadePlotVariant;
  productName?: string;
}): string {
  const product =
    args.productName ??
    "Custom window shades & curtains · SunnyShutter (Toronto)";
  const kindLabel =
    args.variant.productKind === "roller_blackout"
      ? "roller / blackout or light-filtering shade"
      : args.variant.productKind === "zebra"
        ? "zebra dual shade (alternating sheer + opaque bands)"
        : "white sheer S-fold / ripple-fold curtain on slim ceiling track";

  return [
    SALES_FRAME,
    MECHANICS_LOCK,
    `PRODUCT KIND LOCK: ${kindLabel}.`,
    `PULL SIDE LOCK: beaded chain / loop cord ONLY on the ${args.variant.pullSide.toUpperCase()} edge if shown.`,
    `CHARACTER LOCK: ${
      args.variant.characterMode === "same_woman"
        ? "one consistent young East-Asian woman, same face/hair/outfit energy across all shots; Canadian condo bedroom/living space."
        : "no required face — product and room only; keep room identity locked."
    }`,
    `CONFLICT: ${args.variant.conflictAngle}.`,
    `BEATS: ${args.variant.beats.join(" || ")}`,
    `Product: ${product}.`,
    "DURATION: exactly 15 seconds, 9:16 vertical sales ad. Quiet room; no music bed from the model.",
  ].join("\n");
}

export function shadeStoryboardVisualBible(
  variant: SunnyShutterShadePlotVariant,
): string {
  return [
    "Photorealistic Canadian condo / modern home interior. Premium sales still, not artsy film still.",
    `Product kind: ${variant.productKind}. Match supplied shade/curtain reference photos exactly.`,
    `If a pull chain is shown, it is ONLY on the ${variant.pullSide} edge of the headrail — never center.`,
    variant.characterMode === "same_woman"
      ? "Same young East-Asian woman throughout: long dark hair, casual home clothes or soft robe, consistent face."
      : "No people required; keep product geometry perfect.",
    "Same room and same window for every frame in this video.",
    "WINDOW ANCHOR (CEO): the SAME window with the SunnyShutter covering is the visual protagonist of every frame — it stays large (roughly half the frame or more), fully inside frame, shot from the same camera position and angle across all frames; identical window frame color, trim, and outside view. Any person is secondary and never blocks the covering.",
    "No logo, no text, no captions, no phone numbers, no QR codes in the image. Keep the top-left corner of the frame clean for a post-production watermark.",
  ].join(" ");
}
