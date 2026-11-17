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

/**
 * 成片详情页的大标题（2026-11-17）：比 `libraryDisplayTitle` 再短一截——第一句还长的时候只取它的第一小句
 *（到第一个逗号 / 冒号为止，通常就是商品名或这条片在讲什么）。详情页的主角是视频：标题占三行，视频就被挤到第二屏。
 * 太短的小句（不到 4 个字）不取，免得标题只剩「我们」这样的半句话。
 */
export function libraryHeadline(title: string, maxChars = 22): string {
  const sentence = libraryDisplayTitle(title, 200);
  if (Array.from(sentence).length <= maxChars) return sentence;
  const clause = sentence.split(/[，,：:、—]|\s[-–·]\s/u)[0]?.trim() ?? "";
  const picked = Array.from(clause).length >= 4 ? clause : sentence;
  const chars = Array.from(picked);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : picked;
}
