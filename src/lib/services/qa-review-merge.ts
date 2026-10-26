import type { Prisma } from "@prisma/client";
import {
  FINAL_FRAME_QA_KEY,
  type FinalFrameQaMark,
} from "@/lib/video-generation/final-frame-qa-mark";

/**
 * QAReview 的 AI 字段按**归属**合并（P01-E1；#16 审查 item 4 否决了通用并集）。
 *
 * aiScoreBreakdown / aiIssues 是 JSON 列，两个写入方各管各的键：
 *   - runAIQA（qa-service）拥有 8 维打分键与自己的问题：每次整块替换自己的部分，
 *     只保留对方的 `finalFrameQa` 键和「[成片复检]」前缀的问题；
 *   - 成片级复检（final-frame-qa-service / ensureQAPendingStub）拥有 `finalFrameQa` 键与
 *     「[成片复检]」前缀的问题：整体替换自己的部分（不深合并——复检由 issues 转 ok 时问题要清空），
 *     不碰 8 维打分与别人的问题。
 * 纯函数，不触库。
 */
export const FINAL_FRAME_QA_ISSUE_PREFIX = "[成片复检]";

type JsonRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issueList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isFinalFrameQaIssue(issue: unknown): boolean {
  return typeof issue === "string" && issue.startsWith(FINAL_FRAME_QA_ISSUE_PREFIX);
}

export function prefixFinalFrameQaIssue(detail: string): string {
  return detail.startsWith(FINAL_FRAME_QA_ISSUE_PREFIX)
    ? detail
    : `${FINAL_FRAME_QA_ISSUE_PREFIX} ${detail}`;
}

type AiColumns = { aiScoreBreakdown: Prisma.InputJsonValue; aiIssues: Prisma.InputJsonValue };

/** runAIQA 的写入：替换自己的打分与问题，保留复检的键与前缀问题。 */
export function mergeAiQaReview(
  existing: { aiScoreBreakdown: unknown; aiIssues: unknown },
  patch: { breakdown: JsonRecord; issues: unknown[] },
): AiColumns {
  const prior = isPlainObject(existing.aiScoreBreakdown) ? existing.aiScoreBreakdown : {};
  const finalFrameQa = prior[FINAL_FRAME_QA_KEY];
  const breakdown: JsonRecord = { ...patch.breakdown };
  if (finalFrameQa !== undefined) breakdown[FINAL_FRAME_QA_KEY] = finalFrameQa;
  const issues = [...patch.issues, ...issueList(existing.aiIssues).filter(isFinalFrameQaIssue)];
  return {
    aiScoreBreakdown: breakdown as Prisma.InputJsonValue,
    aiIssues: issues as Prisma.InputJsonValue,
  };
}

/** 成片级复检的写入：整体替换 finalFrameQa 与自己前缀的问题，保留别人的一切。 */
export function mergeFinalFrameQaReview(
  existing: { aiScoreBreakdown: unknown; aiIssues: unknown },
  patch: { mark: FinalFrameQaMark; issues: string[] },
): AiColumns {
  const prior = isPlainObject(existing.aiScoreBreakdown) ? existing.aiScoreBreakdown : {};
  const breakdown: JsonRecord = { ...prior, [FINAL_FRAME_QA_KEY]: patch.mark };
  const issues = [
    ...issueList(existing.aiIssues).filter((issue) => !isFinalFrameQaIssue(issue)),
    ...patch.issues.map(prefixFinalFrameQaIssue),
  ];
  return {
    aiScoreBreakdown: breakdown as Prisma.InputJsonValue,
    aiIssues: issues as Prisma.InputJsonValue,
  };
}
