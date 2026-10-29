/**
 * 视频评测集（2026-10-29，「下一轮往哪走」文档 §下一轮计划 第 1 项）的纯逻辑：
 * 用例校验、臂解析、续跑判定、待花费统计、盲评左右编排、AI 预评归一、人评票数汇总。
 * 不读 env、不触网，便于单测（tests/video-golden-set.test.ts）。驱动在 scripts/eval/video-golden-set.ts。
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * 六项打分，0–2（0 = 明显不行，1 = 能看但有毛病，2 = 没毛病）。
 * 问题写给人评与 AI 预评同一份；voice 只能听，AI 看图不评它（由人评与音轨检查给）。
 */
export const GOLDEN_SET_DIMENSIONS = [
  { id: "hook", label: "前 2 秒钩子", question: "前 2 秒有没有让人想看下去的东西（问题、反差、动作），而不是平淡的摆拍？" },
  { id: "product", label: "商品一致", question: "商品在每个镜头都和参考照片一致吗：形状、比例、颜色、结构、印字；特写不变形？" },
  { id: "physics", label: "道具与物理", question: "有没有道具重复、凭空出现或消失；手、液体、蒸汽、布料是否合理？" },
  { id: "story", label: "故事与兑现", question: "是否按商家描述的顺序发生、结尾兑现卖点，没有前后颠倒？" },
  { id: "motion", label: "真实运动", question: "每个镜头都有看得见的动作吗，而不是静帧推拉、幻灯片？" },
  { id: "voice", label: "口播完整", question: "有清楚的人声、整句说完不被截断；画外音时画面里没人对口型？" },
] as const;

export type GoldenSetDimension = (typeof GOLDEN_SET_DIMENSIONS)[number]["id"];
export const GOLDEN_SET_DIMENSION_IDS = GOLDEN_SET_DIMENSIONS.map((dimension) => dimension.id) as GoldenSetDimension[];
/// AI 看帧能评的五项（voice 要听）
export const AI_SCORED_DIMENSIONS = GOLDEN_SET_DIMENSION_IDS.filter((id) => id !== "voice");

const caseSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,31}$/u),
    category: z.string().min(1).max(40),
    productName: z.string().min(1).max(80),
    productImages: z.array(z.string().url().startsWith("https://")).min(1).max(4),
    story: z.string().min(8).max(1000),
    voiceover: z.string().min(1).max(200),
    durationSec: z.literal(15),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
    watchFor: z.array(z.string().min(1).max(80)).max(8).default([]),
  })
  .strict();

export type GoldenSetCase = z.infer<typeof caseSchema>;

const casesFileSchema = z
  .object({ version: z.literal(1), note: z.string().optional(), cases: z.array(caseSchema).min(1).max(40) })
  .strict();

/** 读用例文件（JSON 已解析）；id 重复或字段不合法直接抛错，不带着坏用例去花钱。 */
export function parseGoldenSetCases(raw: unknown): GoldenSetCase[] {
  const { cases } = casesFileSchema.parse(raw);
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`用例 id 重复：${item.id}`);
    ids.add(item.id);
  }
  return cases;
}

/** 只跑部分用例：`--cases bottle,watch`；没给就是全部，给了不认识的 id 直接报错。 */
export function selectCases(cases: readonly GoldenSetCase[], raw: string | null | undefined): GoldenSetCase[] {
  const wanted = (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (wanted.length === 0) return [...cases];
  const unknown = wanted.filter((id) => !cases.some((item) => item.id === id));
  if (unknown.length > 0) throw new Error(`不认识的用例：${unknown.join(", ")}`);
  return cases.filter((item) => wanted.includes(item.id));
}

export interface GoldenSetArm {
  /// 报告与目录里用的短名，如 old / new
  id: string;
  /// git 版本（提交号、分支、HEAD）；"." = 当前工作区（含没提交的改动）
  ref: string;
}

/** `old=3431ff4,new=HEAD` → 两个臂；臂名小写字母开头、不重复。 */
export function parseArms(raw: string | null | undefined): GoldenSetArm[] {
  const arms = (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [id, ref, ...rest] = part.split("=").map((value) => value.trim());
      if (!id || !ref || rest.length > 0 || !/^[a-z][a-z0-9-]{0,23}$/u.test(id)) {
        throw new Error(`臂的写法是 名字=git 版本，如 old=3431ff4：${part}`);
      }
      return { id, ref };
    });
  if (arms.length === 0) throw new Error("至少给一个臂：--arms old=<git 版本>,new=<git 版本>");
  const ids = arms.map((arm) => arm.id);
  if (new Set(ids).size !== ids.length) throw new Error(`臂名重复：${ids.join(", ")}`);
  return arms;
}

export type GoldenSetTaskStatus = "pending" | "submitted" | "succeeded" | "failed";

export interface GoldenSetFrameRecord {
  ordinal: number;
  prompt: string;
  status: GoldenSetTaskStatus;
  /// 第几次提交（从 0 起）。Shuyu 把请求键当幂等键：重试必须换键，否则拿回的还是那张失败的单
  attempt: number;
  taskId: string | null;
  planId: string | null;
  points: number | null;
  outputUrl: string | null;
  error: string | null;
  submittedAt: string | null;
  finishedAt: string | null;
}

export interface GoldenSetVideoRecord {
  prompt: string;
  negativePrompt: string | null;
  durationSec: number;
  status: GoldenSetTaskStatus;
  attempt: number;
  taskId: string | null;
  planId: string | null;
  points: number | null;
  outputUrl: string | null;
  /// 下载到本地的成片（相对运行目录）；有它才算这一条做完
  localFile: string | null;
  error: string | null;
  submittedAt: string | null;
  finishedAt: string | null;
}

/** 一条用例在一个臂上的全部进度（落盘 JSON；续跑读它，绝不重复提交已经有任务号的帧与视频）。 */
export interface GoldenSetRunRecord {
  caseId: string;
  armId: string;
  ref: string;
  sha: string;
  frames: GoldenSetFrameRecord[];
  /// 人物设定图（Kelin 精控流程「GPT 人物版」，10-29）：帧出齐后从开场帧出一张；没有这个字段或 null = 这一臂不出
  characterSheet?: GoldenSetFrameRecord | null;
  video: GoldenSetVideoRecord;
}

/// 设定图在记录里借用帧的结构，序号固定 -1（不是故事板的第几帧）
export const CHARACTER_SHEET_ORDINAL = -1;

export function initialRunRecord(args: {
  caseId: string;
  armId: string;
  ref: string;
  sha: string;
  framePrompts: readonly string[];
  characterSheetPrompt?: string | null;
  video: { prompt: string; negativePrompt: string | null; durationSec: number };
}): GoldenSetRunRecord {
  const blank = { status: "pending" as const, attempt: 0, taskId: null, planId: null, points: null, outputUrl: null, error: null, submittedAt: null, finishedAt: null };
  return {
    caseId: args.caseId,
    armId: args.armId,
    ref: args.ref,
    sha: args.sha,
    frames: args.framePrompts.map((prompt, ordinal) => ({ ordinal, prompt, ...blank })),
    characterSheet: args.characterSheetPrompt ? { ordinal: CHARACTER_SHEET_ORDINAL, prompt: args.characterSheetPrompt, ...blank } : null,
    video: { ...args.video, ...blank, localFile: null },
  };
}

export type GoldenSetNextStep =
  | { kind: "submit_frame"; ordinal: number }
  | { kind: "poll_frame"; ordinal: number }
  | { kind: "submit_sheet" }
  | { kind: "poll_sheet" }
  | { kind: "submit_video" }
  | { kind: "poll_video" }
  | { kind: "download_video" }
  | { kind: "done" }
  | { kind: "failed"; reason: string };

/**
 * 下一步做什么：帧按顺序一张张出（第 N 帧要拿第 N−1 帧当前帧参考，与线上一致），帧齐了才出视频。
 * 已有任务号的只续查、不重提；失败就停在这条（报告里如实记失败，不自动换线路、不自动重试）。
 */
export function nextGoldenSetStep(record: GoldenSetRunRecord): GoldenSetNextStep {
  for (const frame of record.frames) {
    if (frame.status === "succeeded") continue;
    if (frame.status === "failed") return { kind: "failed", reason: `帧 ${frame.ordinal + 1} 失败：${frame.error ?? "未知原因"}` };
    if (frame.status === "submitted") return { kind: "poll_frame", ordinal: frame.ordinal };
    return { kind: "submit_frame", ordinal: frame.ordinal };
  }
  const sheet = record.characterSheet;
  if (sheet && sheet.status !== "succeeded") {
    if (sheet.status === "failed") return { kind: "failed", reason: `人物设定图失败：${sheet.error ?? "未知原因"}` };
    if (sheet.status === "submitted") return { kind: "poll_sheet" };
    return { kind: "submit_sheet" };
  }
  const { video } = record;
  if (video.status === "failed") return { kind: "failed", reason: `视频失败：${video.error ?? "未知原因"}` };
  if (video.status === "submitted") return { kind: "poll_video" };
  if (video.status === "pending") return { kind: "submit_video" };
  return video.localFile ? { kind: "done" } : { kind: "download_video" };
}

/**
 * `--retry-failed`：把停在失败的帧与视频放回待提交，尝试次数 +1（请求键随之换新，Shuyu 才会真的再建一单）。
 * 只动失败的那一步；已成功、已提交的一概不碰。返回放回了几步。
 * 提交时 504 / 超时、没拿到任务号的也换新键：Shuyu 对重复的请求键回 409 且不给已建单的任务号，又没有按键反查的接口，
 * 沿用原键只会卡在 409。代价是那一单若其实建了会多扣一次，上限是这一步的单价（与线上故事板帧的 ACK_UNKNOWN 处理同一取舍）。
 * 唯一例外：Shuyu 当场拒单时明说「用同一个请求键重试、没扣点」（10-29 参考图校验暂时不可用），照它说的沿用原键。
 */
const SHUYU_SAME_KEY_RETRY = /retry with the same idempotency-key/iu;

export function retryFailedSteps(record: GoldenSetRunRecord): number {
  let reset = 0;
  for (const step of [...record.frames, ...(record.characterSheet ? [record.characterSheet] : []), record.video]) {
    if (step.status !== "failed") continue;
    const sameKey = !step.taskId && SHUYU_SAME_KEY_RETRY.test(step.error ?? "");
    Object.assign(step, {
      status: "pending",
      attempt: (step.attempt ?? 0) + (sameKey ? 0 : 1),
      taskId: null,
      error: null,
      submittedAt: null,
      finishedAt: null,
    });
    reset += 1;
  }
  return reset;
}

/** 提交用的请求键：同一步同一次尝试永远同一个键（续跑重提也不会多建单），换尝试才换键。 */
export function goldenSetRequestKey(
  runKey: string,
  record: GoldenSetRunRecord,
  step: "video" | "sheet" | { ordinal: number },
): string {
  const suffix =
    step === "video"
      ? `video-a${record.video.attempt ?? 0}`
      : step === "sheet"
        ? `sheet-a${record.characterSheet?.attempt ?? 0}`
        : `frame-${step.ordinal}-a${record.frames[step.ordinal]?.attempt ?? 0}`;
  return `${runKey}:${record.armId}:${record.caseId}:${suffix}`;
}

/** 这一条还要花钱的部分：没提交过的帧（人物设定图同价，算进帧）与视频（已提交的不再计，失败的停在那里不计）。 */
export function pendingSpend(record: GoldenSetRunRecord): { frames: number; videos: number } {
  if (nextGoldenSetStep(record).kind === "failed") return { frames: 0, videos: 0 };
  return {
    frames:
      record.frames.filter((frame) => frame.status === "pending").length +
      (record.characterSheet?.status === "pending" ? 1 : 0),
    videos: record.video.status === "pending" ? 1 : 0,
  };
}

export interface BlindPair {
  caseId: string;
  left: string;
  right: string;
}

/**
 * 盲评左右：每条用例按 sha256(runKey:caseId) 决定哪个臂放左边，可复现、人看不出规律。
 * 只支持两个臂（盲评就是二选一）。
 */
export function blindLayout(runKey: string, caseIds: readonly string[], arms: readonly [string, string]): BlindPair[] {
  return caseIds.map((caseId) => {
    const flip = createHash("sha256").update(`${runKey}:${caseId}`).digest()[0] % 2 === 1;
    return { caseId, left: flip ? arms[1] : arms[0], right: flip ? arms[0] : arms[1] };
  });
}

export type DimensionScore = { score: 0 | 1 | 2 | null; evidence: string };

/** AI 预评原始 JSON → 每项 0–2 + 一句证据；缺项、越界、非整数都记 null（不猜）。 */
export function normalizeAiScores(raw: unknown): Record<GoldenSetDimension, DimensionScore> {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const scores = record.scores && typeof record.scores === "object" ? (record.scores as Record<string, unknown>) : record;
  return Object.fromEntries(
    GOLDEN_SET_DIMENSION_IDS.map((id) => {
      const entry = scores[id];
      const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const value = typeof entry === "number" ? entry : item.score;
      const score = value === 0 || value === 1 || value === 2 ? value : null;
      const evidence = typeof item.evidence === "string" ? item.evidence.replace(/\s+/gu, " ").trim().slice(0, 200) : "";
      return [id, { score, evidence }];
    }),
  ) as Record<GoldenSetDimension, DimensionScore>;
}

export type BlindVote = "left" | "right" | "tie";
export type BlindVotes = Record<string, Partial<Record<GoldenSetDimension | "overall", BlindVote>>>;
export interface WinTieLoss {
  win: number;
  tie: number;
  loss: number;
}

/**
 * 人评汇总：按盲评布局把「左 / 右 / 差不多」还原成臂的胜平负。没评的项不计。
 * 返回每项与「整体更想发哪条」（overall）各自的胜平负。
 */
export function tallyBlindVotes(
  layout: readonly BlindPair[],
  votes: BlindVotes,
): Record<GoldenSetDimension | "overall", Record<string, WinTieLoss>> {
  const keys = [...GOLDEN_SET_DIMENSION_IDS, "overall" as const];
  const arms = [...new Set(layout.flatMap((pair) => [pair.left, pair.right]))];
  const result = Object.fromEntries(
    keys.map((key) => [key, Object.fromEntries(arms.map((arm) => [arm, { win: 0, tie: 0, loss: 0 }]))]),
  ) as Record<GoldenSetDimension | "overall", Record<string, WinTieLoss>>;
  for (const pair of layout) {
    const caseVotes = votes[pair.caseId] ?? {};
    for (const key of keys) {
      const vote = caseVotes[key];
      if (!vote) continue;
      const left = result[key][pair.left];
      const right = result[key][pair.right];
      if (vote === "tie") {
        left.tie += 1;
        right.tie += 1;
      } else {
        (vote === "left" ? left : right).win += 1;
        (vote === "left" ? right : left).loss += 1;
      }
    }
  }
  return result;
}
