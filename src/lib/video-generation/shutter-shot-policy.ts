/**
 * SunnyShutter-only plantation-shutter safe-shot hard gate.
 *
 * Applies to the `sunnyshutter` client lock profile for all of that merchant's
 * products. Other clients must not inherit these motions / preconditions —
 * onboard a separate lock profile later.
 *
 * Goal: the SunnyShutter pipeline must never *request* suicide shots
 * (hand-on-tilt-bar, finger-adjusted louvers, etc.). Model residual
 * hallucinations on safe shots are handled by human frame QA.
 *
 * Spec: docs/acceptance/shutter-safe-shot-policy.md
 */

export const ALLOWED_SHOT_MOTIONS = [
  "static_product",
  "panel_hinge_open",
  "louver_tilt_no_hands",
  "presenter_point_only",
] as const;

export type ShotMotion = (typeof ALLOWED_SHOT_MOTIONS)[number];

export const PRODUCT_MECHANICS_PRECONDITIONS = `PRODUCT MECHANICS PRECONDITIONS (must obey):
- These are plantation shutters (solid louvers on a hinged panel), NOT a door and NOT curtains.
- Allowed motions only: (1) whole panel swings open/closed on side hinges like a door; (2) all louvers tilt together slowly as one unit; (3) camera move with shutters static.
- Forbidden: fingers gripping/twisting the thin vertical tilt bar; broken/discontinuous tilt bar; jagged teeth on the tilt bar; melting hands into wood; inventing hardware; uneven louver spacing; warping frames.
- The vertical tilt bar, if visible, must remain one continuous straight rod — never split, float, or offset.
- Keep shutter geometry identical to the reference images: louver width, frame color, panel layout, hinge side.
- Prefer medium/wide shots. Avoid extreme close-ups of hand-on-tilt-bar.`;

const MOTION_BEAT_HINTS: Record<ShotMotion, string> = {
  static_product:
    "MOTION LOCK: shutters stay static; only a gentle camera push or hold is allowed.",
  panel_hinge_open:
    "MOTION LOCK: exactly one whole shutter panel slowly swings open/closed on its side hinges like a door. No hand on the tilt bar. No single-louver fingering.",
  louver_tilt_no_hands:
    "MOTION LOCK: all louvers tilt together slowly as one unit. No hands in frame. Tilt bar stays one continuous straight rod.",
  presenter_point_only:
    "MOTION LOCK: presenter may point at the shutters from a medium/wide shot but must never touch the tilt bar or individual louvers.",
};

export type UnsafeShutterViolation = {
  code:
    | "hand_on_tilt_bar"
    | "finger_adjust_louver"
    | "rapid_multi_panel"
    | "extreme_louver_macro";
  message: string;
};

const UNSAFE_PATTERNS: Array<{
  code: UnsafeShutterViolation["code"];
  re: RegExp;
  message: string;
}> = [
  {
    code: "hand_on_tilt_bar",
    re: /\b(hand|finger|fingers|grip|gripping|grasp|hold|holding|twist|twisting)\b[\s\S]{0,40}\b(tilt\s*-?\s*bar|tilt\s*-?\s*rod|vertical\s+rod)\b|\b(tilt\s*-?\s*bar|tilt\s*-?\s*rod|vertical\s+rod)\b[\s\S]{0,40}\b(hand|finger|fingers|grip|gripping|grasp|twist|twisting)\b/i,
    message:
      "Prompt requests hand/finger interaction with the tilt bar. Use panel_hinge_open or louver_tilt_no_hands instead.",
  },
  {
    code: "finger_adjust_louver",
    re: /\b(finger|fingers|hand)\b[\s\S]{0,40}\b(louver|slat)s?\b[\s\S]{0,20}\b(adjust|tilt|twist|flick|push|pull)\b|\b(adjust|tilt|twist|flick)\b[\s\S]{0,20}\b(one|single|individual)\b[\s\S]{0,20}\b(louver|slat)\b/i,
    message:
      "Prompt requests finger adjustment of individual louvers. Only whole-panel or no-hands unified tilt is allowed.",
  },
  {
    code: "rapid_multi_panel",
    re: /\b(rapid|fast|quick|multiple|several)\b[\s\S]{0,30}\b(panels?)\b[\s\S]{0,30}\b(open|close|fold|swing)/i,
    message:
      "Prompt requests rapid or multi-panel folding. Limit to one slow hinge open.",
  },
  {
    code: "extreme_louver_macro",
    re: /\b(extreme\s+macro|macro\s+of\s+dense\s+louvers|close-?up\s+scan\s+of\s+(the\s+)?louvers)\b/i,
    message:
      "Prompt requests extreme dense-louver macro scanning, which warps parallel geometry.",
  },
];

export function isAllowedShotMotion(value: string): value is ShotMotion {
  return (ALLOWED_SHOT_MOTIONS as readonly string[]).includes(value);
}

/**
 * Strip prohibition / policy text so "Forbidden: fingers on tilt bar" does not
 * false-positive as a requested suicide shot.
 */
function actionablePromptText(prompt: string): string {
  return prompt
    .replace(
      /PRODUCT MECHANICS PRECONDITIONS[\s\S]*?(?=\n[A-Z][A-Z0-9 /_-]*LOCK:|\n*$)/i,
      "\n",
    )
    .replace(
      /^.*\b(forbidden|never|avoid|must not|do not|don't|no hands?|must never)\b.*$/gim,
      "",
    )
    .trim();
}

export function findUnsafeShutterPromptViolations(
  prompt: string,
): UnsafeShutterViolation[] {
  const text = actionablePromptText(prompt);
  if (!text) return [];
  const hits: UnsafeShutterViolation[] = [];
  for (const rule of UNSAFE_PATTERNS) {
    if (rule.re.test(text)) {
      hits.push({ code: rule.code, message: rule.message });
    }
  }
  return hits;
}

export type RenderSafeShutterPromptArgs = {
  motion: ShotMotion;
  productName: string;
  /** Timed storyboard beats (plot direction). */
  beats: string[];
  /** Multi-angle product identity lock (reference images are ground truth). */
  productLock?: string;
  characterLock?: string;
  voiceLock?: string;
  microExpressionLock?: string;
  aspectHint?: string;
};

/**
 * Deterministic prompt builder for shutter ads.
 * Callers choose a ShotMotion enum; free-form suicide actions are not expressible.
 */
export function renderSafeShutterPrompt(
  args: RenderSafeShutterPromptArgs,
): string {
  if (!isAllowedShotMotion(args.motion)) {
    throw new Error(
      `Shot motion "${String(args.motion)}" is not an allowed ShotMotion`,
    );
  }
  if (!args.productName.trim()) {
    throw new Error("productName is required");
  }
  if (!args.beats.length || args.beats.every((beat) => !beat.trim())) {
    throw new Error("at least one storyboard beat is required");
  }

  const productLock =
    args.productLock?.trim() ||
    "Use only the supplied product reference images as visual truth from multiple angles. Preserve louver width, frame color, panel layout, hinge side, material and proportions in every frame. Never redesign the shutters.";

  const lines = [
    args.aspectHint?.trim() || "9:16 vertical premium home-decor ad segment.",
    `Product: ${args.productName.trim()}.`,
    "",
    PRODUCT_MECHANICS_PRECONDITIONS,
    "",
    `PRODUCT IDENTITY LOCK:\n${productLock}`,
    "",
    MOTION_BEAT_HINTS[args.motion],
    "",
    "PLOT LOCK (follow this storyboard direction exactly; do not invent extra actions):",
    ...args.beats.map((beat) => `- ${beat.trim()}`).filter(Boolean),
  ];

  if (args.characterLock?.trim()) {
    lines.push("", `CHARACTER LOCK:\n${args.characterLock.trim()}`);
  }
  if (args.voiceLock?.trim()) {
    lines.push("", `VOICE/TONE LOCK:\n${args.voiceLock.trim()}`);
  }
  if (args.microExpressionLock?.trim()) {
    lines.push(
      "",
      `MICRO-EXPRESSION LOCK:\n${args.microExpressionLock.trim()}`,
    );
  }

  lines.push(
    "",
    "Style: photorealistic real-footage look, stable camera, medium/wide preferred.",
    "no on-screen text, no logos, no captions, no URLs, no QR codes, no watermarks.",
  );

  const prompt = lines.join("\n");
  const violations = findUnsafeShutterPromptViolations(prompt);
  if (violations.length > 0) {
    throw new Error(
      `renderSafeShutterPrompt produced unsafe content: ${violations
        .map((v) => v.code)
        .join(", ")}`,
    );
  }
  return prompt;
}

export const __test__ = { UNSAFE_PATTERNS, MOTION_BEAT_HINTS };
