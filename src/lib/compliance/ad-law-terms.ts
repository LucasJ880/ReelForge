/**
 * 广告法极限词检查（2026-11-09 · 抖音发布包）。
 *
 * 《广告法》第九条禁止使用「国家级」「最高级」「最佳」等用语；平台审核实际执行得更宽，
 * 标题 / 正文 / 话题里出现这类词会被限流或驳回。这里是一张**小而明确**的词表：
 * 宁可漏掉生僻说法，也不做模糊匹配——命中必须能指给运营看「是哪个词、在哪」。
 *
 * 命中即拦：发布包里任何一处命中都不让导出，改掉才放行。不做自动改写（改写会改变文案意思，
 * 得由人决定）。
 *
 * 纯函数、无依赖：客户端编辑时实时复查与服务端落库前复查用的是同一份。
 */

export type AdLawCategory = "superlative" | "ranking" | "authority" | "absolute";

export const AD_LAW_CATEGORY_LABELS: Record<AdLawCategory, string> = {
  superlative: "最高级用语",
  ranking: "排名 / 唯一性用语",
  authority: "级别 / 权威背书用语",
  absolute: "绝对化承诺",
};

interface AdLawRule {
  /** 展示给运营的规范写法 */
  term: string;
  category: AdLawCategory;
  pattern: RegExp;
}

/// 「最」后面跟这些字是时间 / 顺序，不是最高级（最近、最后、最终、最初）。
const SUPERLATIVE_ZUI = /最(?![近后終终初])/gu;
/// 「第一」后面跟这些字是序数（第一步、第一次、第一眼、第一天、第一时间）。
const RANK_FIRST = /第一(?![步次眼天时時])/gu;

function literal(term: string, category: AdLawCategory): AdLawRule {
  return {
    term,
    category,
    pattern: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu"),
  };
}

/**
 * 词表。顺序即优先级：同一位置长词先占（「全网最低」不会再报一次「最」）。
 */
const RULES: readonly AdLawRule[] = [
  // ---- 排名 / 唯一性 ----
  literal("独一无二", "ranking"),
  literal("绝无仅有", "ranking"),
  literal("史无前例", "ranking"),
  literal("遥遥领先", "ranking"),
  literal("销量冠军", "ranking"),
  literal("领导品牌", "ranking"),
  { term: "NO.1", category: "ranking", pattern: /N[Oo0][.．]?\s*1(?!\d)/gu },
  { term: "TOP1", category: "ranking", pattern: /TOP\s*[.．]?\s*1(?!\d)/giu },
  { term: "第一", category: "ranking", pattern: RANK_FIRST },
  literal("唯一", "ranking"),
  literal("首选", "ranking"),
  literal("首个", "ranking"),
  literal("首家", "ranking"),
  literal("冠军", "ranking"),
  literal("王牌", "ranking"),
  // ---- 级别 / 权威背书 ----
  literal("国家级", "authority"),
  literal("世界级", "authority"),
  literal("全球级", "authority"),
  literal("宇宙级", "authority"),
  literal("顶级", "authority"),
  literal("顶尖", "authority"),
  literal("极品", "authority"),
  literal("驰名", "authority"),
  literal("特供", "authority"),
  literal("专供", "authority"),
  // ---- 绝对化承诺 ----
  { term: "100%", category: "absolute", pattern: /(?<!\d)100\s*[%％]/gu },
  literal("百分百", "absolute"),
  literal("百分之百", "absolute"),
  literal("绝对", "absolute"),
  literal("永久", "absolute"),
  literal("万能", "absolute"),
  literal("根治", "absolute"),
  literal("无敌", "absolute"),
  literal("史上", "absolute"),
  // ---- 最高级（放最后：前面的长词先占位） ----
  literal("极致", "superlative"),
  literal("终极", "superlative"),
  { term: "最", category: "superlative", pattern: SUPERLATIVE_ZUI },
];

/** 词表里的规范写法（给界面的「检查了哪些词」说明用） */
export const AD_LAW_TERMS: readonly string[] = RULES.map((rule) => rule.term);

export interface AdLawHit {
  /** 词表里的规范写法 */
  term: string;
  /** 文案里实际出现的写法 */
  matched: string;
  category: AdLawCategory;
  /** 在原文里的位置（UTF-16 下标，可直接 slice） */
  start: number;
  end: number;
}

/** 找出一段文字里的全部极限词，按出现位置排序；同一位置只报最先命中的规则。 */
export function findAdLawTerms(text: string | null | undefined): AdLawHit[] {
  if (!text) return [];
  const hits: AdLawHit[] = [];
  const taken: Array<[number, number]> = [];
  for (const rule of RULES) {
    /// 每次新建，避免全局正则的 lastIndex 跨调用残留
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      taken.push([start, end]);
      hits.push({ term: rule.term, matched: match[0], category: rule.category, start, end });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export type DouyinCopyField = "title" | "body" | "hashtag";

export interface AdLawFieldHit extends AdLawHit {
  field: DouyinCopyField;
  /** field = hashtag 时是第几个话题（从 0 起） */
  hashtagIndex?: number;
}

export interface AdLawCheckResult {
  /** true = 没有命中，可以导出 */
  ok: boolean;
  hits: AdLawFieldHit[];
  /** 去重后的命中词（规范写法），给错误信息用 */
  terms: string[];
}

/** 发布文案整体检查：标题 + 正文 + 每个话题。 */
export function checkAdLawCopy(copy: {
  title?: string | null;
  body?: string | null;
  hashtags?: readonly string[] | null;
}): AdLawCheckResult {
  const hits: AdLawFieldHit[] = [
    ...findAdLawTerms(copy.title).map((hit) => ({ ...hit, field: "title" as const })),
    ...findAdLawTerms(copy.body).map((hit) => ({ ...hit, field: "body" as const })),
    ...(copy.hashtags ?? []).flatMap((tag, hashtagIndex) =>
      findAdLawTerms(tag).map((hit) => ({ ...hit, field: "hashtag" as const, hashtagIndex })),
    ),
  ];
  return { ok: hits.length === 0, hits, terms: [...new Set(hits.map((hit) => hit.term))] };
}

/** 把一段文字按命中切成片段，界面据此把命中词标红。 */
export function splitByAdLawHits(text: string): Array<{ text: string; hit: AdLawHit | null }> {
  const hits = findAdLawTerms(text);
  if (hits.length === 0) return text ? [{ text, hit: null }] : [];
  const parts: Array<{ text: string; hit: AdLawHit | null }> = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) parts.push({ text: text.slice(cursor, hit.start), hit: null });
    parts.push({ text: text.slice(hit.start, hit.end), hit });
    cursor = hit.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: null });
  return parts;
}
