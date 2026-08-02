/**
 * O4 验收 3 · 原创性重复度检查（PRD §3 O4）。
 *
 * 验收标准原话：「由配方生成的内容是原创的：画面、文案、口播全部我方生成，
 * **可通过重复度检查**」。
 *
 * 这不是锦上添花的质量分，是**合规主张的证据链**：我们对外说生成内容是原创的，
 * 就得有一把尺子能证明，而不是靠人工抽查几句。
 *
 * ## 为什么用字符 n-gram 而不是分词
 *
 * 参考素材可能是中文、英文或混排。中文没有空格，按词切要引入分词器，
 * 而分词器的边界差异会让同一段文字得出不同的分数。
 * 字符 n-gram 对两种语言都稳定，且对「换几个字但结构照抄」这种情况敏感 ——
 * 那正是我们要拦的东西。
 *
 * ## 为什么是 containment 而不是 Jaccard
 *
 * 我们要问的是「**我方产出里有多少是从参考里来的**」，不是「两段文字有多像」。
 * 参考素材可能很长（一整条广告的文案），Jaccard 会被长度差稀释掉。
 * containment = |交集| / |我方 n-gram 集合|，长度无关，问的正是那个问题。
 */

/**
 * n-gram 长度。
 *
 * 取 5：中文里 5 个字已经是一个完整短语（「免费上门量尺」是 6 字），
 * 低于这个长度会把「的时候」「我们的」这类通用搭配也算成重复，噪声太大。
 * 英文里 5 个字符大约是一个词根，同样够。
 */
export const NGRAM_SIZE = 5;

/**
 * 判定阈值。
 *
 * 0.15 是刻意保守的：结构相同、措辞不同的产出通常落在 0.02-0.08，
 * 而真的抄了一句话（十几个字）就会顶到 0.2 以上。
 * 宁可偶尔误报让人看一眼，也不要漏掉真正的抄袭。
 */
export const ORIGINALITY_THRESHOLD = 0.15;

export type OriginalityReport = {
  /// 我方产出中来自参考素材的 n-gram 占比（0-1）。
  containment: number;
  passed: boolean;
  /// 命中的最长连续重复片段，便于人工复核到底抄了什么。
  longestOverlap: string | null;
  /// 参与比对的 n-gram 数量。太少说明文本太短，分数不可信。
  sampleSize: number;
};

/**
 * 归一化：去掉标点、空白与大小写差异。
 *
 * 不去掉这些的话，把「免费上门量尺！」改成「免费上门量尺。」就能骗过检查 ——
 * 那显然不是原创。
 */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

export function toNgrams(text: string, size = NGRAM_SIZE): Set<string> {
  const normalized = normalizeForComparison(text);
  const grams = new Set<string>();
  for (let i = 0; i + size <= normalized.length; i += 1) {
    grams.add(normalized.slice(i, i + size));
  }
  return grams;
}

/**
 * 检查我方产出对参考素材的重复度。
 *
 * @param produced 我方生成的全部文本（文案 / 口播 / 叠字）
 * @param references 参考素材文本。**注意**：正常流程里我们连参考原文都不存，
 *   所以这个检查通常是在生成当次、内存里拿着参考做的，
 *   而不是事后从库里翻出别人的文案再比 —— 库里根本没有。
 */
export function checkOriginality(
  produced: string,
  references: string[],
): OriginalityReport {
  const producedGrams = toNgrams(produced);
  if (producedGrams.size === 0) {
    /// 文本太短，得不出可信的分数。**不要返回 passed: true** ——
    /// 那等于用「没检查」冒充「检查通过」。
    return {
      containment: 0,
      passed: false,
      longestOverlap: null,
      sampleSize: 0,
    };
  }

  const referenceGrams = new Set<string>();
  for (const reference of references) {
    for (const gram of toNgrams(reference)) referenceGrams.add(gram);
  }
  if (referenceGrams.size === 0) {
    /// 没有参考素材可比 —— 这时产出必然是原创的（没东西可抄）。
    return {
      containment: 0,
      passed: true,
      longestOverlap: null,
      sampleSize: producedGrams.size,
    };
  }

  let hits = 0;
  for (const gram of producedGrams) {
    if (referenceGrams.has(gram)) hits += 1;
  }
  const containment = hits / producedGrams.size;

  return {
    containment,
    passed: containment < ORIGINALITY_THRESHOLD,
    longestOverlap: findLongestOverlap(produced, references),
    sampleSize: producedGrams.size,
  };
}

/**
 * 找出最长的连续重复片段。
 *
 * 分数说「有多少重复」，这个说「重复的是什么」——
 * 人工复核时后者才是能下判断的东西。
 */
export function findLongestOverlap(
  produced: string,
  references: string[],
): string | null {
  const a = normalizeForComparison(produced);
  let longest = "";
  for (const reference of references) {
    const b = normalizeForComparison(reference);
    if (!a || !b) continue;
    /// 从 n-gram 长度起步逐步加长：短于它的重合本来就不算问题。
    for (let start = 0; start < a.length; start += 1) {
      let length = longest.length > NGRAM_SIZE ? longest.length : NGRAM_SIZE;
      while (start + length <= a.length) {
        const candidate = a.slice(start, start + length);
        if (!b.includes(candidate)) break;
        longest = candidate;
        length += 1;
      }
    }
  }
  return longest.length >= NGRAM_SIZE ? longest : null;
}

/**
 * 把一份内容计划摊平成一段可检查的文本。
 * 钩子、正文、CTA、叠字都要查 —— 抄袭最容易发生在钩子那一句。
 */
export function flattenPlanText(plan: {
  posts: Array<{
    copy: { hook: string; body: string; cta: string | null };
    slides: Array<{ overlayText: string | null }>;
  }>;
}): string {
  return plan.posts
    .flatMap((post) => [
      post.copy.hook,
      post.copy.body,
      post.copy.cta ?? "",
      ...post.slides.map((slide) => slide.overlayText ?? ""),
    ])
    .join("\n");
}
