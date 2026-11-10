/**
 * 商品尺寸（2026-11-10）：在描述后面补一句「商品实际大小：…」。
 *
 * 出片模型不知道商品有多大，同一只杯子这一镜一掌能握、下一镜比脸还大。做法和「换个开头」一样朴素：
 * 把尺寸写成描述里看得见的一行（商家随时能改能删），出方案与镜头卡照着它定商品和手、家具的比例。
 * 写法要具体到能比划：「直径约 8 厘米，一只手能握住」，不是「小巧」。
 *
 * 纯函数与常量：客户端组件、测试共用，不引服务端模块。
 */
export const PRODUCT_SIZE_MAX = 60;

const LEADS = { zh: "商品实际大小：", en: "Actual product size: " } as const;
type SizeLocale = keyof typeof LEADS;

/// 整行匹配：中英文引子都认（界面切了语言，原来那一行也要认得出来、换得掉）
const SIZE_LINE = /(?:^|\n)[ \t]*(?:商品实际大小[：:]|Actual product size:)[ \t]?([^\n]*)/u;
const SIZE_LINE_ALL = new RegExp(SIZE_LINE.source, "gu");

/** 描述里现在带的尺寸（引子后面的那段话）；没带 → null。 */
export function detectProductSize(prompt: string): string | null {
  const match = SIZE_LINE.exec(prompt);
  return match ? match[1] : null;
}

/** 去掉描述里的尺寸行，还原成其余部分。 */
export function stripProductSize(prompt: string): string {
  return prompt
    .replace(SIZE_LINE_ALL, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * 给描述写上 / 换掉 / 去掉尺寸行。size 为空（或只有空白）= 去掉。尺寸行总在最后、另起一行。
 * 描述为空时不加（先让商家写要拍什么）；加上去会超过上限就原样返回。
 */
export function applyProductSize(prompt: string, size: string, locale: SizeLocale, maxChars = 4000): string {
  const base = stripProductSize(prompt);
  const text = Array.from(size.replace(/[\r\n]+/gu, " ").replace(/^\s+/u, "")).slice(0, PRODUCT_SIZE_MAX).join("");
  if (!text.trim() || !base) return base;
  const next = `${base}\n${LEADS[locale]}${text}`;
  return Array.from(next).length > maxChars ? prompt : next;
}
