/**
 * 口播稿跨刷新保留（2026-10-28 闭环轮 E2E：刷新 / 热更新后故事板从服务端恢复，描述也恢复，
 * 但商家改过或 AI 写的口播稿丢了，成片悄悄念回模板稿）。稿子跟描述绑在一起存 sessionStorage：
 * 恢复时描述对得上才还原，对不上（换了一条片）就当没有。
 */
export const VOICEOVER_DRAFT_STORAGE_KEY = "aivora.voiceover-draft.v1";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveVoiceoverDraft(storage: DraftStorage, prompt: string, script: string | null): void {
  try {
    if (script === null || !prompt.trim()) storage.removeItem(VOICEOVER_DRAFT_STORAGE_KEY);
    else storage.setItem(VOICEOVER_DRAFT_STORAGE_KEY, JSON.stringify({ prompt: prompt.trim(), script }));
  } catch {
    // Storage unavailable: the draft lives for this page view only.
  }
}

export function loadVoiceoverDraft(storage: DraftStorage, prompt: string): string | null {
  try {
    const parsed = JSON.parse(storage.getItem(VOICEOVER_DRAFT_STORAGE_KEY) ?? "null") as
      | { prompt?: unknown; script?: unknown }
      | null;
    if (parsed?.prompt === prompt.trim() && typeof parsed.script === "string") return parsed.script;
  } catch {
    // Corrupt or unavailable storage: fall back to the template script.
  }
  return null;
}
