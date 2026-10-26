/**
 * Storyboard gacha（抽卡）+ 择优 — product identity first.
 *
 * 背景（CEO WeChat 0720）：单张故事版直出的一致性不够——成片出现房间漂移、
 * 幻视叠影、构图重点不在窗上。对策：每个故事版帧并行生成 N 个候选，
 * 用 vision 评审按「窗户/产品是主角 + 与已选帧同房同窗同人 + 零文字」择优。
 *
 * 失败策略：评审自身出错（未配置 OPENAI_API_KEY / 超时 / 返回不合法）一律
 * fail-open 取第一个候选，抽卡增强不能变成管线单点故障。
 */

import { analyzeImages, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";

const JUDGE_TIMEOUT_MS = 60_000;

export type GachaJudgeVerdict = {
  chosenIndex: number;
  /** false = 评审被跳过（未配置/出错），chosenIndex 恒为 0 */
  checked: boolean;
  note: string;
};

/// 身份与几何两条扣分条目：段级漂移判据（frame-drift.FRAME_DRIFT_SYSTEM）只复用这两条，信封自己写。
export const STORYBOARD_RUBRIC_IDENTITY_PENALTIES = [
  "- product identity, room, camera, or cast drift vs the CONTEXT images",
  "- invented or warped product geometry, controls, parts, labels, accessories, packaging, or unsupported states",
] as const;

/// 扣分条目：N 选 1 的抽卡评审与逐帧审帧（reviewStoryboardFrames）共用这一份，信封各写各的。
const STORYBOARD_RUBRIC_PENALTIES = [
  "- any visible text, logo, watermark, caption, phone number, or QR code (instant score ≤ 2)",
  STORYBOARD_RUBRIC_IDENTITY_PENALTIES[0],
  "- the product not being the clear visual protagonist of the composition",
  STORYBOARD_RUBRIC_IDENTITY_PENALTIES[1],
  "- an intended action that is unclear, physically impossible, or not supported by the reference images",
  "- distorted human anatomy, extra fingers, merged hands, or hands obscuring the proof",
  "- weak proof clarity, incoherent continuity, or a composition that contradicts the requested beat",
].join("\n");

const JUDGE_SYSTEM = `You are a strict casting director for ecommerce product video ads.
You will receive images in two groups, in order:
1) CONTEXT images (already-locked storyboard frames and/or product reference photos). Product reference photos are the only truth for product identity, visible parts, material, color, proportions, packaging, and supported states. Locked storyboard frames define the room, camera, cast, and continuity that a later candidate MUST reproduce.
2) CANDIDATE images — alternative generations for ONE storyboard frame.
Score each CANDIDATE 0-10 against the criteria given by the user. Heavily penalize:
${STORYBOARD_RUBRIC_PENALTIES}
Respond with JSON only:
{"scores":[{"index":0,"score":7,"issues":"..."}],"best":0}
"index" is the 0-based index WITHIN THE CANDIDATE GROUP. "best" is the winning candidate index.`;

export function genericJudgeSystem(): string {
  return JUDGE_SYSTEM;
}

export async function judgeStoryboardCandidates(args: {
  candidateUrls: string[];
  criteria: string;
  contextUrls?: string[];
  label?: string;
}): Promise<GachaJudgeVerdict> {
  const { candidateUrls } = args;
  if (candidateUrls.length <= 1) {
    return { chosenIndex: 0, checked: false, note: "single candidate" };
  }
  if (!isLLMAvailable() || isLLMForcedMock()) {
    return { chosenIndex: 0, checked: false, note: "vision judge unavailable" };
  }
  const contextUrls = (args.contextUrls ?? []).slice(0, 4);
  try {
    const judged = (async (): Promise<GachaJudgeVerdict> => {
      const { data } = await analyzeImages(
        [...contextUrls, ...candidateUrls],
        JUDGE_SYSTEM,
        [
          `The first ${contextUrls.length} image(s) are CONTEXT; the following ${candidateUrls.length} image(s) are CANDIDATES.`,
          `Frame criteria: ${args.criteria}`,
          "Score every candidate and pick the best. JSON only.",
        ].join("\n"),
      );
      const best = Number((data as { best?: unknown }).best);
      if (!Number.isInteger(best) || best < 0 || best >= candidateUrls.length) {
        throw new Error(`judge returned invalid best=${String(best)}`);
      }
      const scores = Array.isArray((data as { scores?: unknown }).scores)
        ? ((data as { scores: { index?: number; score?: number; issues?: string }[] }).scores)
        : [];
      const note = scores
        .map((s) => `#${s.index}:${s.score}${s.issues ? `(${s.issues})` : ""}`)
        .join(" ")
        .slice(0, 500);
      return { chosenIndex: best, checked: true, note };
    })();
    return await Promise.race([
      judged,
      new Promise<GachaJudgeVerdict>((resolve) =>
        setTimeout(
          () =>
            resolve({
              chosenIndex: 0,
              checked: false,
              note: `judge timeout >${JUDGE_TIMEOUT_MS / 1000}s`,
            }),
          JUDGE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (error) {
    return {
      chosenIndex: 0,
      checked: false,
      note: `judge error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 抽卡数：默认 4（用户 2026-07-20：抽卡不限成本）；STORYBOARD_GACHA_CANDIDATES 可调（1 = 关闭抽卡）。 */
export function gachaCandidateCount(): number {
  const parsed = Number.parseInt(
    process.env.STORYBOARD_GACHA_CANDIDATES ?? "",
    10,
  );
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 8) return parsed;
  return 4;
}

/**
 * Select the first successful Shuyu candidate in submission order. Shuyu
 * storyboard paths never pick among candidates with a judge; quality review
 * happens afterwards, per frame, through reviewStoryboardFrames (D-1:
 * STORYBOARD_AI_REVIEW=off|shadow|block, default off — the two locked
 * SunnyShutter pipelines stay judge-free).
 */
export async function generateFrameDeterministically(args: {
  generateOnce: (candidateIndex: number) => Promise<string>;
  candidateCount?: number;
  label?: string;
}): Promise<{
  imageUrl: string;
  candidateUrls: string[];
  judge: GachaJudgeVerdict;
}> {
  const count = args.candidateCount ?? gachaCandidateCount();
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, k) => args.generateOnce(k)),
  );
  const candidateUrls = settled
    .filter((s): s is PromiseFulfilledResult<string> => s.status === "fulfilled")
    .map((s) => s.value);
  if (candidateUrls.length === 0) {
    const firstError = settled.find(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error(`${args.label ?? "gacha"}: all candidates failed`);
  }
  return {
    imageUrl: candidateUrls[0]!,
    candidateUrls,
    judge: {
      chosenIndex: 0,
      checked: false,
      note: "deterministic first successful Shuyu candidate",
    },
  };
}

/**
 * 并行生成 N 个候选 → 评审择优。generateOnce 抛错的候选被丢弃，
 * 只要 ≥1 个成功即可返回；全失败则抛最后一个错误。
 */
export async function generateFrameWithGacha(args: {
  generateOnce: (candidateIndex: number) => Promise<string>;
  candidateCount?: number;
  criteria: string;
  contextUrls?: string[];
  label?: string;
}): Promise<{
  imageUrl: string;
  candidateUrls: string[];
  judge: GachaJudgeVerdict;
}> {
  const count = args.candidateCount ?? gachaCandidateCount();
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, k) => args.generateOnce(k)),
  );
  const candidateUrls = settled
    .filter((s): s is PromiseFulfilledResult<string> => s.status === "fulfilled")
    .map((s) => s.value);
  if (candidateUrls.length === 0) {
    const firstError = settled.find(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error(`${args.label ?? "gacha"}: all candidates failed`);
  }
  const judge = await judgeStoryboardCandidates({
    candidateUrls,
    criteria: args.criteria,
    contextUrls: args.contextUrls,
    label: args.label,
  });
  return {
    imageUrl: candidateUrls[judge.chosenIndex] ?? candidateUrls[0]!,
    candidateUrls,
    judge,
  };
}

// ---------- 逐帧审帧（P01-D，D-1） ----------

export interface StoryboardFrameReviewItem {
  /** 0 起的帧序号（与传入的 frameUrls 顺序一致） */
  index: number;
  pass: boolean;
  score: number;
  /** 不过时给重抽用的修正要求（英文，作 promptOverride）；过了可为空 */
  issues: string;
}

export type StoryboardFrameReviewResult =
  | { checked: true; frames: StoryboardFrameReviewItem[]; note: string }
  | {
      checked: false;
      reason: "vision_unavailable" | "no_frames" | "timeout" | "error";
      note: string;
    };

/// 单次审帧（一整轮 4–5 帧一起看）的超时；调用方按它 + 余量向 tick 预算占位。
export const STORYBOARD_REVIEW_TIMEOUT_MS = 25_000;
/// 低于这个分即判不过（模型自己给的 pass=false 也算不过）。阈值校准等 E13。
export const STORYBOARD_REVIEW_PASS_SCORE = 6;
const REVIEW_PRODUCT_REFS_MAX = 3;
const REVIEW_ISSUES_MAX = 600;

const REVIEW_SYSTEM = `You are a strict quality reviewer for ecommerce product video storyboards.
You will receive images in two groups, in order:
1) PRODUCT reference photos (may be empty). They are the only truth for product identity, visible parts, material, color, proportions, packaging, and supported states.
2) STORYBOARD frames of ONE storyboard, in story order. Every frame must stay in the same room, camera language, cast, and product identity as the other frames.
Review EVERY storyboard frame independently and score it 0-10. Heavily penalize:
${STORYBOARD_RUBRIC_PENALTIES}
A frame passes only when it can safely be used as a keyframe for image-to-video generation.
For a failing frame, "issues" must be one short corrective instruction for redrawing that frame (what to fix, not what is wrong in general).
Respond with JSON only:
{"frames":[{"index":0,"pass":true,"score":8,"issues":""}]}
"index" is the 0-based index WITHIN THE STORYBOARD GROUP. Include exactly one entry per storyboard frame.`;

export function storyboardReviewSystem(): string {
  return REVIEW_SYSTEM;
}

/** 纯函数：把模型回包解析成逐帧结论；条目缺失 / 越界 / 重复即整包不合法（抛错，由调用方记 skipped）。 */
export function parseStoryboardFrameReview(
  data: unknown,
  frameCount: number,
  passScore = STORYBOARD_REVIEW_PASS_SCORE,
): StoryboardFrameReviewItem[] {
  const raw = (data as { frames?: unknown } | null)?.frames;
  if (!Array.isArray(raw)) throw new Error("review returned no frames array");
  const byIndex = new Map<number, StoryboardFrameReviewItem>();
  for (const entry of raw as Array<Record<string, unknown>>) {
    const index = Number(entry?.index);
    const score = Number(entry?.score);
    if (!Number.isInteger(index) || index < 0 || index >= frameCount) {
      throw new Error(`review returned invalid index=${String(entry?.index)}`);
    }
    if (byIndex.has(index)) throw new Error(`review returned duplicate index=${index}`);
    if (!Number.isFinite(score)) throw new Error(`review returned invalid score for #${index}`);
    const issues = typeof entry.issues === "string"
      ? entry.issues.replace(/\s+/gu, " ").trim().slice(0, REVIEW_ISSUES_MAX)
      : "";
    const clamped = Math.max(0, Math.min(10, score));
    byIndex.set(index, {
      index,
      pass: entry.pass !== false && clamped >= passScore,
      score: clamped,
      issues,
    });
  }
  if (byIndex.size !== frameCount) {
    throw new Error(`review covered ${byIndex.size}/${frameCount} frames`);
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * 一整轮故事板逐帧审：一次 vision 调用看全部帧（连续性要横向比），每帧给 {index, pass, score, issues}。
 * 只复用抽卡评审的扣分条目，不复用它的 N 选 1 解析。
 *
 * 失败策略与抽卡一致：vision 不可用 / 超时 / 回包不合法 → checked=false，调用方据此不阻塞。
 */
export async function reviewStoryboardFrames(args: {
  frameUrls: string[];
  productUrls?: string[];
  beats?: string[];
  timeoutMs?: number;
  passScore?: number;
  analyze?: typeof analyzeImages;
  visionAvailable?: () => boolean;
}): Promise<StoryboardFrameReviewResult> {
  const { frameUrls } = args;
  if (frameUrls.length === 0) return { checked: false, reason: "no_frames", note: "no frames" };
  const available = args.visionAvailable ?? (() => isLLMAvailable() && !isLLMForcedMock());
  if (!available()) {
    return { checked: false, reason: "vision_unavailable", note: "vision review unavailable" };
  }
  const analyze = args.analyze ?? analyzeImages;
  const productUrls = (args.productUrls ?? []).slice(0, REVIEW_PRODUCT_REFS_MAX);
  const timeoutMs = args.timeoutMs ?? STORYBOARD_REVIEW_TIMEOUT_MS;
  const beats = (args.beats ?? [])
    .slice(0, frameUrls.length)
    .map((beat, index) => `#${index}: ${beat}`)
    .join("\n");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reviewed = (async (): Promise<StoryboardFrameReviewResult> => {
      const { data } = await analyze(
        [...productUrls, ...frameUrls],
        REVIEW_SYSTEM,
        [
          `The first ${productUrls.length} image(s) are PRODUCT references; the following ${frameUrls.length} image(s) are STORYBOARD frames.`,
          ...(beats ? [`Intended beat per frame:\n${beats}`] : []),
          "Review every storyboard frame. JSON only.",
        ].join("\n"),
        { detail: "low", maxTokens: 900 },
      );
      const frames = parseStoryboardFrameReview(data, frameUrls.length, args.passScore);
      const note = frames
        .map((frame) => `#${frame.index}:${frame.score}${frame.pass ? "" : "✗"}`)
        .join(" ");
      return { checked: true, frames, note };
    })();
    return await Promise.race([
      reviewed,
      new Promise<StoryboardFrameReviewResult>((resolve) => {
        timer = setTimeout(
          () => resolve({ checked: false, reason: "timeout", note: `review timeout >${timeoutMs / 1000}s` }),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    return {
      checked: false,
      reason: "error",
      note: `review error: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
