/**
 * 商家订单在产品库/表现页展示的标题（中文优先，避免英文 prompt 直接当标题）。
 */

export interface BusinessDisplayTitleInput {
  rawPrompt: string;
  language?: string | null;
  brandKit?: { brandName?: string | null } | null;
  durationSec?: number;
  platform?: string | null;
}

function firstLine(text: string, max = 80): string {
  const t = text.trim();
  if (!t) return "";
  return t.split("\n")[0].slice(0, max);
}

function isChineseLanguage(language?: string | null): boolean {
  if (!language) return true;
  const code = language.split("-")[0].toLowerCase();
  return code === "zh";
}

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** 从英文/混合 prompt 推断中文产品线标签 */
export function inferProductLineZh(prompt: string): string | null {
  const p = prompt.toLowerCase();
  if (/blackout|遮光|全遮光/.test(p)) return "遮光帘竖屏广告";
  if (/sheer|纱帘|薄纱|窗纱/.test(p)) return "纱帘竖屏广告";
  if (/curtain|窗帘|drape|shutter|百叶/.test(p)) return "窗帘竖屏广告";
  if (/blind|卷帘/.test(p)) return "卷帘竖屏广告";
  if (/bedroom|卧室/.test(p)) return "卧室场景广告";
  if (/living\s*room|客厅/.test(p)) return "客厅场景广告";
  if (/hydrat|运动饮料|sports\s*drink/.test(p)) return "饮品竖屏广告";
  return null;
}

export function deriveBusinessOrderTitle(
  input: BusinessDisplayTitleInput,
): string {
  const brand = input.brandKit?.brandName?.trim();
  const first = firstLine(input.rawPrompt, 120);
  const useZh = isChineseLanguage(input.language) || hasCjk(input.rawPrompt);

  if (useZh) {
    if (hasCjk(first) && first.length >= 4) return first;
    const line = inferProductLineZh(input.rawPrompt);
    if (brand && line) return `${brand} · ${line}`;
    if (brand) return `${brand} · TikTok 竖屏广告`;
    if (line) return line;
    return "广告视频";
  }

  if (brand) {
    const suffix = input.durationSec ? ` · ${input.durationSec}s ad` : " — vertical ad";
    return `${brand}${suffix}`.slice(0, 120);
  }
  return first || "Untitled ad";
}
