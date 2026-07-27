/**
 * Product-agnostic commerce shot gate.
 *
 * A recipe may choose a broad motion, but product mechanics must come from the
 * supplied profile. This prevents templates from inventing buttons, hinges,
 * zippers, transformations, or human interactions that the product cannot do.
 */

export const GENERIC_SHOT_MOTIONS = [
  "static_product",
  "reveal_transition",
  "operate_demo",
  "presenter_point",
] as const;

export type GenericShotMotion = (typeof GENERIC_SHOT_MOTIONS)[number];

export type CommerceProductMotionProfile = {
  productType: string;
  identityLocks: string[];
  demonstrableActions: string[];
  revealTransitions: string[];
  forbiddenActions?: string[];
};

export type RenderSafeCommercePromptArgs = {
  motion: GenericShotMotion;
  productName: string;
  productProfile: CommerceProductMotionProfile;
  beats: string[];
  operation?: string;
  aspectHint?: string;
  characterLock?: string;
  voiceLock?: string;
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function assertSupportedMechanics(args: RenderSafeCommercePromptArgs): void {
  if (args.motion === "operate_demo") {
    const operation = normalized(args.operation ?? "");
    const allowed = args.productProfile.demonstrableActions.map(normalized);
    if (!operation || !allowed.includes(operation)) {
      throw new Error(
        "operate_demo requires an exact demonstrable action from the product profile",
      );
    }
  }
  if (
    args.operation &&
    args.productProfile.forbiddenActions?.map(normalized).includes(
      normalized(args.operation),
    )
  ) {
    throw new Error("requested operation is forbidden by the product profile");
  }
  if (
    args.motion === "reveal_transition" &&
    args.productProfile.revealTransitions.length === 0
  ) {
    throw new Error(
      "reveal_transition requires a supported reveal transition in the product profile",
    );
  }
}

function motionLock(args: RenderSafeCommercePromptArgs): string {
  switch (args.motion) {
    case "static_product":
      return "MOTION LOCK: the product remains static; use only a stable hold, gentle push, orbit, or cut between supplied reference angles.";
    case "reveal_transition":
      return `MOTION LOCK: use one supported reveal only: ${args.productProfile.revealTransitions.join(" OR ")}. Preserve product identity before and after the cut.`;
    case "operate_demo":
      return `MOTION LOCK: demonstrate exactly this supported action: ${args.operation?.trim()}. Do not invent another control, joint, opening, or transformation.`;
    case "presenter_point":
      return "MOTION LOCK: a presenter may point beside the product without obscuring it, picking it up, or operating unverified mechanics.";
  }
}

export function renderSafeCommercePrompt(
  args: RenderSafeCommercePromptArgs,
): string {
  if (!(GENERIC_SHOT_MOTIONS as readonly string[]).includes(args.motion)) {
    throw new Error(`Unsupported generic shot motion: ${String(args.motion)}`);
  }
  if (!args.productName.trim()) throw new Error("productName is required");
  if (!args.productProfile.productType.trim()) {
    throw new Error("productProfile.productType is required");
  }
  if (args.productProfile.identityLocks.length === 0) {
    throw new Error("product profile requires at least one identity lock");
  }
  if (!args.beats.some((beat) => beat.trim())) {
    throw new Error("at least one storyboard beat is required");
  }
  assertSupportedMechanics(args);

  const lines = [
    args.aspectHint?.trim() || "9:16 vertical ecommerce video.",
    `Product: ${args.productName.trim()} (${args.productProfile.productType.trim()}).`,
    "",
    "PRODUCT TRUTH LOCK:",
    "- Supplied product images are the only visual truth. Never invent an unseen feature, accessory, control, material, label, or product state.",
    ...args.productProfile.identityLocks.map((lock) => `- ${lock.trim()}`),
    "",
    motionLock(args),
    "",
    "PLOT LOCK (follow these beats in order; do not add product actions):",
    ...args.beats.map((beat) => `- ${beat.trim()}`).filter(Boolean),
  ];
  if (args.characterLock?.trim()) {
    lines.push("", `CHARACTER LOCK:\n${args.characterLock.trim()}`);
  }
  if (args.voiceLock?.trim()) {
    lines.push("", `VOICE/TONE LOCK:\n${args.voiceLock.trim()}`);
  }
  lines.push(
    "",
    "Style: photorealistic commercial footage, stable product geometry, clear proof, controlled human anatomy.",
    "No on-screen text, no captions, no invented logos, no URLs, no QR codes, no watermarks.",
  );
  const prompt = lines.join("\n");
  if (prompt.length >= 5_000) {
    throw new Error("generic commerce prompt exceeds 5000 characters");
  }
  return prompt;
}
