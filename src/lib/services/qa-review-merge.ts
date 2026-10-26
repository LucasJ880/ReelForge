import type { Prisma } from "@prisma/client";

/**
 * QAReview 的 AI 字段合并写（P01-E1）。
 *
 * aiScoreBreakdown / aiIssues 是 JSON 列，被不止一个写入方共用：
 *   - runAIQA（qa-service）写 8 维打分；
 *   - 成片级复检（P01-E，final-frame-qa）在同一行上挂 `finalFrameQa` 子对象并追加问题。
 * 以前 runAIQA 整块覆盖，后写的会把先写的擦掉。这里统一成：对象深合并（同键新值胜出），
 * 数组去重追加（按 JSON 身份判重），其它类型新值胜出。纯函数，不触库。
 */

type JsonRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identity(value: unknown): string {
  return typeof value === "string" ? `s:${value}` : `j:${JSON.stringify(value)}`;
}

/** 数组去重追加：保留 existing 顺序，再按出现顺序追加 next 里尚未出现的项。 */
export function mergeJsonArray(existing: unknown, next: unknown): unknown[] {
  const base = Array.isArray(existing) ? [...existing] : [];
  const incoming = Array.isArray(next) ? next : next === undefined ? [] : [next];
  const seen = new Set(base.map(identity));
  for (const item of incoming) {
    const key = identity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    base.push(item);
  }
  return base;
}

/** 对象深合并：两边都是对象就递归；两边都是数组就去重追加；否则 patch 胜出（undefined 不覆盖）。 */
export function mergeJsonObject(existing: unknown, patch: unknown): JsonRecord {
  const base: JsonRecord = isPlainObject(existing) ? { ...existing } : {};
  if (!isPlainObject(patch)) return base;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = base[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      base[key] = mergeJsonObject(current, value);
    } else if (Array.isArray(current) && Array.isArray(value)) {
      base[key] = mergeJsonArray(current, value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

export interface QaReviewAiFieldsPatch {
  breakdown?: JsonRecord;
  issues?: unknown[];
}

/**
 * 给 Prisma update 用的合并结果：只返回被触碰的列，调用方展开进 data。
 * breakdown 深合并进 aiScoreBreakdown，issues 去重追加进 aiIssues。
 */
export function mergeQaReviewAiFields(
  existing: { aiScoreBreakdown: unknown; aiIssues: unknown },
  patch: QaReviewAiFieldsPatch,
): { aiScoreBreakdown?: Prisma.InputJsonValue; aiIssues?: Prisma.InputJsonValue } {
  const out: { aiScoreBreakdown?: Prisma.InputJsonValue; aiIssues?: Prisma.InputJsonValue } = {};
  if (patch.breakdown !== undefined) {
    out.aiScoreBreakdown = mergeJsonObject(existing.aiScoreBreakdown, patch.breakdown) as Prisma.InputJsonValue;
  }
  if (patch.issues !== undefined) {
    out.aiIssues = mergeJsonArray(existing.aiIssues, patch.issues) as Prisma.InputJsonValue;
  }
  return out;
}
