/**
 * 换个开头（2026-11-10）：同一件商品换一种开场方式再拍一条，是做矩阵 / 跑量最常见的下一步。
 * 做法就是在商家的描述后面补一句「开头怎么拍」的方向——出方案与镜头卡照着它排第一个镜头。
 *
 * pain / result 两句与 2026-11-10 真机压测用的一字不差（16 条成片都是带着这两句出的，成片过关）；
 * detail / contrast 是同一写法的新角度，还没有真机样本。
 *
 * 纯函数与常量：客户端组件、脚本、测试共用，不引服务端模块。
 */
export const HOOK_ANGLES = [
  {
    id: "pain",
    zh: { label: "痛点开场", direction: "开头先拍没有它时的麻烦（一个看得见的小窘境），再让商品出场解决。" },
    en: { label: "Open on the problem", direction: "Open on the hassle of not having it (one small, visible awkward moment), then bring the product in to fix it." },
  },
  {
    id: "result",
    zh: { label: "结果前置", direction: "开头第一个画面就是用完之后的效果，再回头交代是怎么做到的。" },
    en: { label: "Result first", direction: "Make the very first shot the result after using it, then go back and show how it got there." },
  },
  {
    id: "detail",
    zh: { label: "细节特写开场", direction: "开头先给商品最有质感的一个细节特写，停一拍，再拉开交代是谁在什么场合用它。" },
    en: { label: "Open on a detail", direction: "Open on a close-up of the product's most tactile detail, hold a beat, then pull back to show who is using it and where." },
  },
  {
    id: "contrast",
    zh: { label: "前后对比开场", direction: "开头把用之前和用之后放在一起对比，一眼看出差别，再展示使用过程。" },
    en: { label: "Before and after", direction: "Open by putting before and after side by side so the difference is obvious at a glance, then show it in use." },
  },
] as const;

export type HookAngleId = (typeof HOOK_ANGLES)[number]["id"];
type HookLocale = "zh" | "en";

/** 只剩引子、后面没有内容的那一行（引子后面还跟着商家自己写的字就不动）。 */
const SOAK_LEAD_IN = /(?:^|\n)[ \t]*开头钩子（[^）\n]{1,20}）[：:][ \t]*(?=\n|$)/gu;

const ALL_DIRECTIONS: readonly string[] = HOOK_ANGLES.flatMap((angle) => [angle.zh.direction, angle.en.direction]);

/** 把描述里已经带着的「开头方向」句子都去掉（不管是哪种语言加的），还原成商家自己写的部分。 */
export function stripHookAngle(prompt: string): string {
  let text = prompt;
  for (const direction of ALL_DIRECTIONS) text = text.split(direction).join("");
  return text
    /// 压测脚本出的片，方向句前面带「开头钩子（痛点开场）：」这样的引子；句子去掉后引子也一起去掉，不留半截
    .replace(SOAK_LEAD_IN, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** 描述里现在带的是哪个开头方向；没带 → null。 */
export function detectHookAngle(prompt: string): HookAngleId | null {
  for (const angle of HOOK_ANGLES) {
    if (prompt.includes(angle.zh.direction) || prompt.includes(angle.en.direction)) return angle.id;
  }
  return null;
}

/**
 * 给描述换一个开头方向：先去掉原来带的，再把新的补在最后（另起一行）。
 * angleId 为 null = 只去掉。描述为空时不加（没有东西可拍，先让商家写）。超过上限就不加、原样返回。
 */
export function applyHookAngle(prompt: string, angleId: HookAngleId | null, locale: HookLocale, maxChars = 4000): string {
  const base = stripHookAngle(prompt);
  if (!angleId || !base) return base;
  const angle = HOOK_ANGLES.find((item) => item.id === angleId);
  if (!angle) return base;
  const next = `${base}\n${angle[locale].direction}`;
  return Array.from(next).length > maxChars ? prompt : next;
}
