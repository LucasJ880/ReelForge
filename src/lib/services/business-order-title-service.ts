import {
  deriveBusinessOrderTitle,
  type BusinessDisplayTitleInput,
} from "@/lib/video-generation/business-display-title";

export type UnifiedProductInput = {
  userType?: string;
  rawPrompt?: string;
  brandKit?: { brandName?: string | null } | null;
};

/** B 端订单默认中文标题；仅当 targetLanguage 明确为 en 时用英文 */
export function resolveOrderDisplayLanguage(
  targetLanguage: string | null,
  userType?: string,
): string | null {
  if (userType === "business") {
    const lang = (targetLanguage ?? "zh").split("-")[0].toLowerCase();
    return lang === "en" ? "en" : "zh";
  }
  return targetLanguage;
}

export function parseUnifiedProductInput(raw: unknown): UnifiedProductInput | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as UnifiedProductInput;
}

export function resolveBusinessOrderTitleFromOrder(order: {
  title: string;
  targetLanguage: string | null;
  targetPlatform: string | null;
  productInput: unknown;
  durationSec?: number | null;
}): string {
  const pi = parseUnifiedProductInput(order.productInput);
  const rawPrompt = pi?.rawPrompt?.trim() || order.title;
  const language = resolveOrderDisplayLanguage(order.targetLanguage, pi?.userType);

  const input: BusinessDisplayTitleInput = {
    rawPrompt,
    language,
    brandKit: pi?.brandKit ?? null,
    durationSec: order.durationSec ?? undefined,
    platform: order.targetPlatform,
  };
  return deriveBusinessOrderTitle(input);
}

/** 是否应将订单标题更新为推导出的中文标题 */
export function shouldUpdateBusinessTitle(
  current: string,
  next: string,
  options?: { force?: boolean },
): boolean {
  if (current === next) return false;
  if (options?.force) return true;
  const currentHasCjk = /[\u4e00-\u9fff]/.test(current);
  const nextHasCjk = /[\u4e00-\u9fff]/.test(next);
  return !currentHasCjk && nextHasCjk;
}
