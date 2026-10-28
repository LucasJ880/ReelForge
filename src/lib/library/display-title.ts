/**
 * 成片详情的标题（2026-10-28 闭环轮 E2E：单条成片的 title 就是商家整段描述，详情页把它当 h1 铺满四行）。
 * 取第一句，过长再截断加省略号；整段描述仍是 `title` 属性与读屏可读的全文。
 */
export function libraryDisplayTitle(title: string, maxChars = 36): string {
  const text = title.replace(/\s+/gu, " ").trim();
  const first = text.split(/(?<=[。！？!?；;])\s*|(?<=\.)\s+/u)[0]?.replace(/[。；;]$/u, "") ?? text;
  const chars = Array.from(first);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : first;
}
