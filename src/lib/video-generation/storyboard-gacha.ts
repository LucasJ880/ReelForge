/**
 * Storyboard gacha（抽卡）+ 择优 — SunnyShutter 一致性优先路径。
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

const JUDGE_SYSTEM = `You are a strict casting director for ecommerce window-covering (shades/shutters/curtains) video ads.
You will receive images in two groups, in order:
1) CONTEXT images (already-locked storyboard frames and/or product reference photos). Product reference photos define ONLY the product's look (fabric, color, opacity, mount style) — the generated scene does NOT need to copy their room. Locked storyboard frames (when the frame criteria says this is a later frame that must match) define the room, window, camera, and person that the candidate MUST reproduce.
2) CANDIDATE images — alternative generations for ONE storyboard frame.
Score each CANDIDATE 0-10 against the criteria given by the user. Heavily penalize:
- any visible text, logo, watermark, caption, phone number, or QR code (instant score ≤ 2)
- room / window / person identity drift vs the CONTEXT images
- the window + covering NOT being the clear visual protagonist of the composition
- warped product geometry (bent headrail, melted fabric, non-parallel louvers)
- pull chain shown anywhere except the required side edge
Respond with JSON only:
{"scores":[{"index":0,"score":7,"issues":"..."}],"best":0}
"index" is the 0-based index WITHIN THE CANDIDATE GROUP. "best" is the winning candidate index.`;

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
