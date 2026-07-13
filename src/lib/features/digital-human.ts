/**
 * Phase 1 sealed feature. This is intentionally not environment-configurable:
 * no plan, role, stale secret, or deployment variable may reopen it.
 */
export const DIGITAL_HUMAN_FEATURE_STATE = "sealed" as const;

export function isDigitalHumanFeatureEnabled(): false {
  return false;
}

export function assertDigitalHumanFeatureEnabled(): void {
  throw new Error("DIGITAL_HUMAN_SEALED: feature is disabled for every plan");
}

export async function runDigitalHumanTrigger<T>(
  trigger: () => Promise<T>,
): Promise<{ executed: false } | { executed: true; value: T }> {
  if (!isDigitalHumanFeatureEnabled()) return { executed: false };
  return { executed: true, value: await trigger() };
}

export const DIGITAL_HUMAN_SEALED_RESPONSE = {
  error: "该功能当前不可用",
  code: "FEATURE_SEALED",
} as const;
