/**
 * 「更多设置」里收尾的那几项（右上角 Logo、片尾落款、字幕）跨刷新保留（2026-11-18 线上真机：故事板等出图时页面刷新了一次，
 * 故事板和描述都恢复了，勾好的右上角 Logo 却回到了没勾——差一点出了一条不带 Logo 的片）。
 * 和口播稿一样跟描述绑在一起存 sessionStorage：恢复时描述对得上才还原，对不上（换了一条片）就当没有。
 * 只存开关和商家自己填的字，不存 Logo 图：图由服务端在合成时按账号取。
 */
export const FINISHING_DRAFT_STORAGE_KEY = "aivora.finishing-draft.v1";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface FinishingDraft {
  cornerLogo: boolean;
  signoffEnabled: boolean;
  signoffBrand: string;
  signoffCta: string;
  signoffLogo: boolean;
  captionsEnabled: boolean;
  captionStyle: string;
  captionPosition: string;
  exportSrt: boolean;
}

export function saveFinishingDraft(storage: DraftStorage, prompt: string, draft: FinishingDraft | null): void {
  try {
    if (draft === null || !prompt.trim()) storage.removeItem(FINISHING_DRAFT_STORAGE_KEY);
    else storage.setItem(FINISHING_DRAFT_STORAGE_KEY, JSON.stringify({ prompt: prompt.trim(), draft }));
  } catch {
    // Storage unavailable: the settings live for this page view only.
  }
}

const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);

export function loadFinishingDraft(storage: DraftStorage, prompt: string): FinishingDraft | null {
  try {
    const parsed = JSON.parse(storage.getItem(FINISHING_DRAFT_STORAGE_KEY) ?? "null") as
      | { prompt?: unknown; draft?: Record<string, unknown> }
      | null;
    const draft = parsed?.draft;
    if (parsed?.prompt !== prompt.trim() || !draft || typeof draft !== "object") return null;
    const signoffBrand = text(draft.signoffBrand, 80);
    const signoffCta = text(draft.signoffCta, 120);
    const captionStyle = text(draft.captionStyle, 40);
    const captionPosition = text(draft.captionPosition, 40);
    if (signoffBrand === null || signoffCta === null || captionStyle === null || captionPosition === null) return null;
    return {
      cornerLogo: draft.cornerLogo === true,
      signoffEnabled: draft.signoffEnabled === true,
      signoffBrand,
      signoffCta,
      signoffLogo: draft.signoffLogo === true,
      captionsEnabled: draft.captionsEnabled !== false,
      captionStyle,
      captionPosition,
      exportSrt: draft.exportSrt !== false,
    };
  } catch {
    // Corrupt or unavailable storage: fall back to the defaults.
  }
  return null;
}
