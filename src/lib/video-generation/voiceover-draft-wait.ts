/**
 * 出故事板前等一份 AI 口播稿（2026-10-29 灰度真机：预填的描述——「重新生成」、帮我写、试试这些、贴链接——
 * 从不触发「离开输入框就起稿」，成片口播是「先看它如何改变日常体验」这类模板套话）。
 *
 * 最多等 limitMs；用户取消这一轮时立刻放手（起稿本身留在后台跑完，写回的稿子照常落到状态）；
 * 起稿失败 / 超时 / 取消一律返回 null，调用方照旧用模板稿，不卡住出故事板。纯函数，客户端可用。
 */
export function awaitVoiceoverDraft(
  draft: Promise<string | null>,
  signal: AbortSignal,
  limitMs: number,
): Promise<string | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (script: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(script?.trim() ? script : null);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), limitMs);
    signal.addEventListener("abort", onAbort, { once: true });
    draft.then(finish, () => finish(null));
  });
}
