/**
 * Per-client hard-lock profiles for video generation.
 *
 * Today only SunnyShutter (`sunnyshutter`) has a locked precondition pack
 * (safe shots, five locks, Image2 storyboard-first). Other merchants must NOT
 * inherit these gates. Add a new profile id when onboarding the next client.
 */

import type { CommerceProductMotionProfile } from "@/lib/video-generation/generic-shot-policy";

export const SUNNYSHUTTER_CLIENT_LOCK_ID = "sunnyshutter" as const;

/** Extensible union — add future client ids here when their pack is ready. */
export type ClientLockProfileId = typeof SUNNYSHUTTER_CLIENT_LOCK_ID;

export type ClientLockHints = {
  /** Explicit profile id from API / acceptance scripts (preferred). */
  clientLockProfileId?: string | null;
  brandName?: string | null;
  productName?: string | null;
  merchantEmail?: string | null;
};

export function normalizeClientLockProfileId(
  raw?: string | null,
): ClientLockProfileId | null {
  if (!raw?.trim()) return null;
  const normalized = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (
    normalized === "sunnyshutter" ||
    normalized === "sunny-shutter" ||
    normalized === "sunny.shutter"
  ) {
    return SUNNYSHUTTER_CLIENT_LOCK_ID;
  }
  return null;
}

/**
 * Resolve which client lock pack applies. Returns null for ordinary customers
 * (no SunnyShutter / shutter-specific hard gates).
 */
export function resolveClientLockProfile(
  hints: ClientLockHints,
): ClientLockProfileId | null {
  const explicit = normalizeClientLockProfileId(hints.clientLockProfileId);
  if (explicit) return explicit;

  const blob = [hints.brandName, hints.productName, hints.merchantEmail]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase();
  if (!blob) return null;

  if (/sunny[\s._-]*shutter/.test(blob)) return SUNNYSHUTTER_CLIENT_LOCK_ID;
  if (/sunnyshutter\.ca/.test(blob)) return SUNNYSHUTTER_CLIENT_LOCK_ID;
  if (/sunny-shutter@/.test(blob)) return SUNNYSHUTTER_CLIENT_LOCK_ID;
  return null;
}

export function usesSunnyShutterLocks(
  profile: ClientLockProfileId | null | undefined,
): boolean {
  return profile === SUNNYSHUTTER_CLIENT_LOCK_ID;
}

/**
 * Product mechanics appended to the shared commerce policy when a client lock
 * is active. Generic constraints remain in force; this profile only narrows
 * product identity and supported motion.
 */
export function clientLockCommerceProductProfile(
  profile: ClientLockProfileId | null | undefined,
): CommerceProductMotionProfile | null {
  if (profile !== SUNNYSHUTTER_CLIENT_LOCK_ID) return null;
  return {
    productType: "plantation shutters",
    identityLocks: [
      "Preserve exact louver width, frame color, panel layout, hinge side, material, and proportions from the supplied references.",
      "The vertical tilt bar, when visible, remains one continuous straight rod.",
      "Keep all louvers parallel and evenly spaced; never warp frames or invent hardware.",
    ],
    demonstrableActions: [
      "swing one whole panel on its side hinges",
      "tilt all louvers together with no hands visible",
    ],
    revealTransitions: [
      "matched-angle cut from the supported before state to the referenced installed state",
      "swing one whole panel on its side hinges",
    ],
    forbiddenActions: [
      "grip or twist the tilt bar",
      "adjust one individual louver",
      "rapidly fold multiple panels",
    ],
  };
}
