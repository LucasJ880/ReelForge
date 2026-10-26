/**
 * 成片级复检（P01-E，影子）在 QAReview.aiScoreBreakdown 上挂的标记（轻模块：无 ffmpeg / vision 依赖，
 * stitch-service 建 QA 桩时写，poll-videos 的消费者改状态，qa-service 的合并写负责不把它擦掉）。
 *
 *   pending  → 成片 READY 时由 ensureQAPendingStub 写入（requestedAt）
 *   checking → cron 认领后占位（checkingAtMs：租期过了别的调用可接手）
 *   ok / issues / skipped → 复检结论（checkedAt、issues、frameCount、skipReason）
 *
 * 影子：只记录，不改 QAReview.status、不改 brief 状态。
 */
export const FINAL_FRAME_QA_KEY = "finalFrameQa";

export type FinalFrameQaStatus = "pending" | "checking" | "ok" | "issues" | "skipped";

export interface FinalFrameQaIssue {
  frameIndex: number;
  kind: "fake_text" | "fake_label" | "product_mismatch";
  detail: string;
}

export interface FinalFrameQaMark {
  status: FinalFrameQaStatus;
  requestedAt?: string;
  checkingAtMs?: number;
  checkedAt?: string;
  frameCount?: number;
  issues?: FinalFrameQaIssue[];
  skipReason?: string;
  /// 是否带了首帧 / 商品参考图参与「同一商品」判定
  referenceUsed?: boolean;
}

export function pendingFinalFrameQaMark(now = new Date()): { [FINAL_FRAME_QA_KEY]: FinalFrameQaMark } {
  return { [FINAL_FRAME_QA_KEY]: { status: "pending", requestedAt: now.toISOString() } };
}

export function readFinalFrameQaMark(breakdown: unknown): FinalFrameQaMark | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const mark = (breakdown as Record<string, unknown>)[FINAL_FRAME_QA_KEY];
  if (!mark || typeof mark !== "object" || Array.isArray(mark)) return null;
  const status = (mark as { status?: unknown }).status;
  if (typeof status !== "string") return null;
  return mark as FinalFrameQaMark;
}
