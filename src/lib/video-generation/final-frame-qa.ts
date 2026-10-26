/**
 * 成片级复检（P01-E，影子）：对合成后的成片抽帧 + 一次 vision 调用。
 *
 * 与段级门禁（frame-qa.ts）的区别：成片**本来就有**后期字幕与尾卡 logo，不能再按「画面零文字」判废。
 * 这里只查三件事：假字（模型生成的畸形 / 伪字母）、假字标（模型画上去的标签 / 徽章 / 价签 / 假品牌标）、
 * 与首帧参考图是否同一商品。结论只记录（影子），永不拦截、永不 throw（fail-open → skipped + 原因）。
 *
 * 抽帧 / 编码复用 frame-qa.ts 的 extractFrames / framesToDataUrls；runFrameTextQa 不动。
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeImages } from "@/lib/ai";
import { probeMedia } from "@/lib/media/ffmpeg-bin";
import { fetchMediaBytes } from "@/lib/storage/trusted-media-url";
import {
  extractFrames,
  framesToDataUrls,
  FRAME_QA_GATE_TIMEOUT_MS,
  isFrameQaEnabled,
} from "@/lib/video-generation/frame-qa";
import type { FinalFrameQaIssue, FinalFrameQaMark } from "@/lib/video-generation/final-frame-qa-mark";

export type { FinalFrameQaIssue } from "@/lib/video-generation/final-frame-qa-mark";

const DEFAULT_FRAME_COUNT = 6;
/** 成片下载上限：60s 1080P 成片通常几十 MB，超过就不是我们合成的东西（#16 item 11） */
export const FINAL_FRAME_QA_MAX_BYTES = 200 * 1024 * 1024;

export interface FinalFrameQaResult {
  status: "ok" | "issues" | "skipped";
  issues: FinalFrameQaIssue[];
  checkedAt: string;
  frameCount: number;
  skipReason?: string;
  /// skipped 且 true = 这次是超时 / 下载被中止之类的瞬时原因，消费者可重排 pending 再试（有次数上限）
  retryable?: boolean;
  referenceUsed: boolean;
}

export const FINAL_FRAME_QA_SYSTEM = `You are the final-cut QA inspector for an AI-generated short-form product ad.
You are looking at the FINISHED video after post-production. The following are EXPECTED and must NOT be flagged:
- clean post-production captions / subtitles rendered as a consistent text band (top, center or bottom);
- an end card / outro that shows the brand logo and a call-to-action line;
- a small brand logo watermark in a corner.
Flag ONLY these three problems, per video frame:
- fakeText: gibberish, warped or misrendered lettering painted by the video model (pseudo-letters, wrong or archaic CJK variants) anywhere OTHER than the clean caption band or the end card.
- fakeLabel: fabricated labels, badges, price tags, certification marks, packaging text or fake brand marks that the model painted onto the product or the scene.
- productMismatch: ONLY when a reference image is supplied as the FIRST image — the hero product in this frame is clearly a different product from the reference (different category, shape or color scheme), not merely a different angle, crop or lighting.
Respond with JSON only: {"frames":[{"index":0,"fakeText":false,"fakeLabel":false,"productMismatch":false,"textContent":"","note":""}, ...]}
— one entry per VIDEO frame, in the order given, and do not include an entry for the reference image.`;

export interface RawFinalFrameFinding {
  index?: number;
  fakeText?: boolean;
  fakeLabel?: boolean;
  productMismatch?: boolean;
  textContent?: string;
  note?: string;
}

/** 纯判定：vision 返回 → 复检结论。没有参考图时 productMismatch 一律忽略（模型没有可比对象）。 */
export function decideFinalFrameVerdict(
  findings: RawFinalFrameFinding[],
  frameCount: number,
  hasReference: boolean,
  checkedAt = new Date(),
): FinalFrameQaResult {
  const issues: FinalFrameQaIssue[] = [];
  for (const finding of findings) {
    const frameIndex = typeof finding.index === "number" ? finding.index : -1;
    const text = finding.textContent ? `「${finding.textContent}」` : "";
    if (finding.fakeText) {
      issues.push({ frameIndex, kind: "fake_text", detail: `检测到假字 / 畸形字形${text}` });
    }
    if (finding.fakeLabel) {
      issues.push({ frameIndex, kind: "fake_label", detail: `检测到假字标（模型画上去的标签 / 徽章 / 价签）${text}` });
    }
    if (hasReference && finding.productMismatch) {
      issues.push({
        frameIndex,
        kind: "product_mismatch",
        detail: `与首帧参考图不是同一商品${finding.note ? `：${finding.note}` : ""}`,
      });
    }
  }
  return {
    status: issues.length === 0 ? "ok" : "issues",
    issues,
    checkedAt: checkedAt.toISOString(),
    frameCount,
    referenceUsed: hasReference,
  };
}

export function skippedFinalFrameVerdict(
  reason: string,
  checkedAt = new Date(),
  options: { retryable?: boolean } = {},
): FinalFrameQaResult {
  return {
    status: "skipped",
    issues: [],
    checkedAt: checkedAt.toISOString(),
    frameCount: 0,
    skipReason: reason,
    ...(options.retryable ? { retryable: true } : {}),
    referenceUsed: false,
  };
}

export interface FinalFrameQaDeps {
  /** vision 可用（默认同段级门禁：未配置 / mock / 显式关闭 → 不可用） */
  isVisionAvailable: () => boolean;
  /** 下载（或读本地）→ 抽帧 → data URL；默认复用 frame-qa 的 extractFrames / framesToDataUrls */
  sampleFrames: (videoUrlOrPath: string, frameCount: number) => Promise<string[]>;
  analyze: typeof analyzeImages;
  now: () => Date;
  timeoutMs: number;
}

async function defaultSampleFrames(videoUrlOrPath: string, frameCount: number): Promise<string[]> {
  const isRemote = /^https?:\/\//i.test(videoUrlOrPath);
  if (!isRemote && !existsSync(videoUrlOrPath)) throw new Error("成片 URL 不可下载");
  const workDir = await mkdtemp(join(tmpdir(), "final-frame-qa-"));
  try {
    let videoPath = videoUrlOrPath;
    if (isRemote) {
      videoPath = join(workDir, "final.mp4");
      /// 边读边计数 + AbortController 超时（库里服务端写入的 URL，允许跟随重定向）；错误信息不带 URL
      const bytes = await fetchMediaBytes(videoUrlOrPath, {
        maxBytes: FINAL_FRAME_QA_MAX_BYTES,
        followRedirects: true,
        timeoutMs: Math.max(5_000, FRAME_QA_GATE_TIMEOUT_MS - 10_000),
      });
      await writeFile(videoPath, bytes);
    }
    const probe = await probeMedia(videoPath).catch(() => null);
    const framePaths = await extractFrames(videoPath, workDir, frameCount, probe);
    return framesToDataUrls(framePaths);
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const defaultDeps: FinalFrameQaDeps = {
  isVisionAvailable: isFrameQaEnabled,
  sampleFrames: defaultSampleFrames,
  analyze: analyzeImages,
  now: () => new Date(),
  timeoutMs: FRAME_QA_GATE_TIMEOUT_MS,
};

/**
 * 主入口：永不 throw。vision 不可用 / 下载抽帧失败 / vision 出错 / 超时 → skipped + 原因。
 * firstFrameRef：首帧 / 商品参考图 URL（作为第一张图送给 vision，用于「同一商品」判定）。
 */
export async function runFinalFrameQa(
  videoUrl: string,
  opts: { firstFrameRef?: string | null; frameCount?: number; deps?: Partial<FinalFrameQaDeps> } = {},
): Promise<FinalFrameQaResult> {
  const deps: FinalFrameQaDeps = { ...defaultDeps, ...opts.deps };
  if (!deps.isVisionAvailable()) {
    return skippedFinalFrameVerdict("vision 不可用（未配置 / mock 模式 / FRAME_QA_DISABLED）", deps.now());
  }
  if (!videoUrl) return skippedFinalFrameVerdict("成片没有可用的 URL", deps.now());
  const frameCount = opts.frameCount ?? DEFAULT_FRAME_COUNT;
  const reference = opts.firstFrameRef?.trim() || null;

  const check = (async (): Promise<FinalFrameQaResult> => {
    const frames = await deps.sampleFrames(videoUrl, frameCount);
    if (frames.length === 0) throw new Error("抽帧结果为空");
    const images = reference ? [reference, ...frames] : frames;
    const user = reference
      ? `The FIRST image is the reference product photo. The remaining ${frames.length} images are frames sampled evenly from the finished video. Inspect each video frame per the policy and respond with the JSON envelope (entries for video frames only).`
      : `These are ${frames.length} frames sampled evenly from the finished video. No reference image is supplied, so leave productMismatch false. Inspect each frame per the policy and respond with the JSON envelope.`;
    const { data } = await deps.analyze(images, FINAL_FRAME_QA_SYSTEM, user);
    const findings = Array.isArray((data as { frames?: unknown }).frames)
      ? ((data as { frames: RawFinalFrameFinding[] }).frames)
      : [];
    if (findings.length === 0) throw new Error("vision 返回缺少 frames 数组");
    return decideFinalFrameVerdict(findings, frames.length, Boolean(reference), deps.now());
  })();

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      check,
      new Promise<FinalFrameQaResult>((resolve) => {
        timer = setTimeout(
          () =>
            resolve(
              skippedFinalFrameVerdict(`复检超时（>${Math.round(deps.timeoutMs / 1000)}s）`, deps.now(), {
                retryable: true,
              }),
            ),
          deps.timeoutMs,
        );
      }),
    ]);
  } catch (err) {
    const message = (err as Error).message;
    return skippedFinalFrameVerdict(`复检执行异常：${message}`, deps.now(), {
      retryable: /timed out|超时/i.test(message),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 结论 → 挂回 QAReview.aiScoreBreakdown.finalFrameQa 的标记；requestedAt / attempts 从上一版标记带过来。 */
export function finalFrameQaMarkFromResult(
  result: FinalFrameQaResult,
  prior?: Pick<FinalFrameQaMark, "requestedAt" | "attempts"> | null,
): FinalFrameQaMark {
  return {
    status: result.status,
    ...(prior?.requestedAt ? { requestedAt: prior.requestedAt } : {}),
    ...(prior?.attempts ? { attempts: prior.attempts } : {}),
    checkedAt: result.checkedAt,
    frameCount: result.frameCount,
    issues: result.issues,
    referenceUsed: result.referenceUsed,
    ...(result.skipReason ? { skipReason: result.skipReason } : {}),
  };
}
