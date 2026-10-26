import { z } from "zod";
import { NEGATIVE_CONSTRAINTS_SEPARATOR } from "./storyboard-beats";

/**
 * P05-C 成片后「点名重做某一段」的纯规则（轻模块：zod + 纯函数，路由与成品库服务静态引用；
 * 客户端面板不引它，说明字数上限由详情页作为 prop 传下去）。
 *
 * 三种行（同一 brief、同一 segmentIndex 可能同时存在）：
 *   - 当前段：挂在成片上（finalVideoId 非空）、没被替换（supersededAt 为空）——拼接、状态聚合、通过率只认它；
 *   - 候选行：replacesJobId 指向当前段、finalVideoId 为空——重做中 / 重做失败 / 重做被取消；
 *     成功后在同一事务里换挂：候选行挂上成片，旧行摘下并写 supersededAt；
 *   - 旧行：supersededAt 非空——被重做替换掉的段，素材保留、不再参与任何聚合。
 * 旧单段流程（没有 FinalVideo）的行 finalVideoId 也为空，但 replacesJobId 为空，按当前段算。
 */

export type SegmentRowShape = {
  replacesJobId?: string | null;
  supersededAt?: Date | string | null;
  finalVideoId?: string | null;
};

export function isSupersededSegmentJob(job: SegmentRowShape): boolean {
  return job.supersededAt != null;
}

export function isSegmentRedoCandidate(job: SegmentRowShape): boolean {
  return job.replacesJobId != null && job.finalVideoId == null && job.supersededAt == null;
}

/** 参与拼接、brief 状态聚合与「重试失败片段」的行：既不是旧行，也不是还没换挂的候选行。 */
export function isCurrentSegmentJob(job: SegmentRowShape): boolean {
  return !isSupersededSegmentJob(job) && !isSegmentRedoCandidate(job);
}

/**
 * render-retry `all: true` 的重试对象：失败的当前段照旧（走 brief 补扣）；候选行每段只看最新的那条，
 * 它失败了才重试（更早的失败候选已被后来的重做取代）；旧行一律不碰。rows 需按 createdAt 升序。
 */
export function selectAllRetryTargets<
  T extends SegmentRowShape & { status: string; segmentIndex?: number | null },
>(rows: readonly T[]): { current: T[]; candidates: T[] } {
  const current = rows.filter((job) => job.status === "FAILED" && isCurrentSegmentJob(job));
  const latest = new Map<number, T>();
  for (const job of rows) {
    if (isSegmentRedoCandidate(job) && job.segmentIndex != null) latest.set(job.segmentIndex, job);
  }
  const candidates = [...latest.values()].filter((job) => job.status === "FAILED");
  return { current, candidates };
}

/** 候选行的幂等键：第 n 次重做（同一段从 1 起数，含失败与取消的）；唯一约束挡住双击。 */
export function segmentRedoLogicalJobKey(briefId: string, segmentIndex: number, n: number): string {
  return `${briefId}:segment:${segmentIndex}:redo:${n}`;
}

/** 客户对这一段的重做说明上限（UTF-16 单位，与供应商的 string.length 校验同口径）。 */
export const SEGMENT_REDO_NOTE_MAX = 400;

const VIDEO_PROMPT_LIMIT = 5000;
const VIDEO_PROMPT_SAFETY = 100;

export const segmentRedoRequestSchema = z
  .object({
    segmentIndex: z.number().int().min(0).max(63),
    promptOverride: z
      .string()
      .trim()
      .max(SEGMENT_REDO_NOTE_MAX)
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .strict();

export type SegmentRedoRequest = z.infer<typeof segmentRedoRequestSchema>;

export type SegmentRedoRejectCode = "INVALID_STATE" | "VALIDATION_FAILED" | "RESOURCE_NOT_FOUND";

export class SegmentRedoRejectedError extends Error {
  constructor(
    readonly code: SegmentRedoRejectCode,
    message: string,
  ) {
    super(message);
    this.name = "SegmentRedoRejectedError";
  }
}

export function parseSegmentRedoRequest(input: unknown): SegmentRedoRequest {
  const parsed = segmentRedoRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new SegmentRedoRejectedError(
      "VALIDATION_FAILED",
      `重做参数不合法：要点名一段（segmentIndex），说明最多 ${SEGMENT_REDO_NOTE_MAX} 字。`,
    );
  }
  return parsed.data;
}

const REDO_NOTE_HEADER = "REDO NOTE (the merchant asked to regenerate only this segment; follow this note where it does not contradict the locks above):";

/**
 * 重做这一段发给供应商的提示词：**每次都从计划里的这一段重新组装**，不在上一次（候选行或旧行）的提示词上累加。
 * planPrompt = directorPlan.segmentPlan[i].seedancePrompt（派发时已按故事板落地，写回了计划）；
 * note = 本次候选行自己的说明（存在候选行 promptText 上，重试同一候选行时原样带上）。
 * 加上说明会超过供应商上限（含负面提示词尾巴）就拒绝，而不是悄悄截断商家的话。
 */
export function composeSegmentRedoPrompt(args: {
  planPrompt: string;
  note?: string | null;
  negativePrompt?: string | null;
}): string {
  const note = args.note?.trim();
  if (!note) return args.planPrompt;
  const prompt = `${args.planPrompt}\n\n${REDO_NOTE_HEADER}\n${note}`;
  const negative = args.negativePrompt?.trim() ?? "";
  const tail = negative ? `${NEGATIVE_CONSTRAINTS_SEPARATOR}${negative}` : "";
  if (prompt.length + tail.length > VIDEO_PROMPT_LIMIT - VIDEO_PROMPT_SAFETY) {
    throw new SegmentRedoRejectedError(
      "VALIDATION_FAILED",
      "这一段的原提示词已经很长，加上你的说明会超过生成服务的上限；请把说明缩短一些。",
    );
  }
  return prompt;
}
