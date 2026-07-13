/**
 * Frame QA Gate — 发片前自动质检门禁（抽帧 + 画面文字/错字检测）。
 *
 * 背景：AI 视频模型烧录的中文字幕常出现错字/异体字（「晒」→「曬」），
 * 且平台策略是「画面零文字，文案一律后期 overlay」。因此任何烧录进画面的
 * 字幕/标题/水印都视为废片信号，必须在段级（VideoJob SUCCEEDED 之前）拦截，
 * 让废段直接进入既有的单段重试闭环，而不是流到成片库再被客户发现。
 *
 * 流程：下载段视频 → ffmpeg 均匀抽 N 帧（低分辨率）→ 一次 vision 调用批量判定
 *       → 任一帧检出叠加文字/畸形字形 → 拦截。
 *
 * 失败策略：门禁自身出错（ffmpeg 缺失 / vision 超时 / 未配置 OPENAI_API_KEY）
 * 一律 fail-open（放行 + 记录 skipReason），质检增强不能变成管线单点故障。
 *
 * 开关：FRAME_QA_DISABLED=true 显式关闭；mock 引擎 / LLM mock 模式自动跳过。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { analyzeImages, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";

const execFileAsync = promisify(execFile);

/** 抽帧数：15s 视频 6 帧 ≈ 每 2.5s 一帧，足以覆盖字幕/水印的持续存在 */
const DEFAULT_FRAME_COUNT = 6;
/** 抽帧宽度：low-detail vision 足够识别字幕，同时控制 token 成本 */
const FRAME_WIDTH = 480;
/** 单次门禁总超时（下载 + 抽帧 + vision），超时即 fail-open */
const GATE_TIMEOUT_MS = 45_000;

export interface FrameQaIssue {
  frameIndex: number;
  detail: string;
}

export interface FrameQaVerdict {
  /** false = 检出废片信号，必须拦截 */
  ok: boolean;
  /** false = 门禁被跳过（未配置/显式关闭/自身出错），此时 ok 恒为 true */
  checked: boolean;
  skipReason?: string;
  frameCount: number;
  issues: FrameQaIssue[];
  /** 给 errorMessage / 日志用的一句话结论 */
  summary: string;
}

const FRAME_QA_SYSTEM = `You are a strict video QA inspector for an AI-generated short-form ad platform.
The platform policy is ZERO burned-in text: captions/subtitles are always added later by a post-production overlay layer, never by the AI video model (AI models frequently misrender CJK glyphs).
You will receive several frames sampled evenly from ONE generated video.
For EACH frame decide:
- hasOverlayText: any burned-in subtitles, captions, titles, watermarks, logos, UI elements, or floating lettering/numbers overlaid on the footage. Small incidental real-world text physically present in the scene (e.g. a thermostat digit, a faint book spine) does NOT count.
- malformedText: any lettering anywhere (overlay OR in-scene) that is gibberish, warped, or contains wrong/archaic CJK character variants.
- textContent: the literal text you can read, if any (empty string if none).
Respond with JSON only: {"frames":[{"index":0,"hasOverlayText":false,"malformedText":false,"textContent":"","note":""}, ...]} — one entry per frame, in the same order as given.`;

interface RawFrameFinding {
  index?: number;
  hasOverlayText?: boolean;
  malformedText?: boolean;
  textContent?: string;
  note?: string;
}

/** 门禁是否启用（可被环境显式关闭；mock 场景自动跳过） */
export function isFrameQaEnabled(): boolean {
  const disabled = process.env.FRAME_QA_DISABLED?.toLowerCase();
  if (disabled === "1" || disabled === "true" || disabled === "yes") return false;
  const mockEngine = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  if (mockEngine === "1" || mockEngine === "true" || mockEngine === "yes") return false;
  if (isLLMForcedMock()) return false;
  return isLLMAvailable();
}

/**
 * 纯判定逻辑：vision 返回 → 拦截结论。
 * 单独导出便于测试：任一帧 hasOverlayText 或 malformedText 即拦截。
 */
export function decideVerdict(
  findings: RawFrameFinding[],
  frameCount: number,
): FrameQaVerdict {
  const issues: FrameQaIssue[] = [];
  for (const f of findings) {
    const idx = typeof f.index === "number" ? f.index : -1;
    if (f.hasOverlayText) {
      issues.push({
        frameIndex: idx,
        detail: `检测到画面叠加文字${f.textContent ? `「${f.textContent}」` : ""}`,
      });
    } else if (f.malformedText) {
      issues.push({
        frameIndex: idx,
        detail: `检测到畸形/错误字形${f.textContent ? `「${f.textContent}」` : ""}`,
      });
    }
  }
  const ok = issues.length === 0;
  return {
    ok,
    checked: true,
    frameCount,
    issues,
    summary: ok
      ? `帧质检通过（${frameCount} 帧无画面文字）`
      : `帧质检拦截：${issues.map((i) => `第${i.frameIndex + 1}帧 ${i.detail}`).join("；")}`,
  };
}

function skipVerdict(reason: string): FrameQaVerdict {
  return {
    ok: true,
    checked: false,
    skipReason: reason,
    frameCount: 0,
    issues: [],
    summary: `帧质检跳过：${reason}`,
  };
}

async function extractFrames(
  videoPath: string,
  outDir: string,
  frameCount: number,
): Promise<string[]> {
  /// 读时长决定抽帧间隔；拿不到就按 15s 兜底
  let durationSec = 15;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      videoPath,
    ]);
    const parsed = Number.parseFloat(stdout.trim());
    if (Number.isFinite(parsed) && parsed > 0) durationSec = parsed;
  } catch {
    /// ffprobe 缺失时沿用默认时长，抽帧仍可进行
  }

  const fps = frameCount / durationSec;
  await execFileAsync("ffmpeg", [
    "-v", "error",
    "-i", videoPath,
    "-vf", `fps=${fps},scale=${FRAME_WIDTH}:-1`,
    "-frames:v", String(frameCount),
    "-q:v", "6",
    join(outDir, "f%02d.jpg"),
    "-y",
  ]);

  const files = (await readdir(outDir))
    .filter((f) => f.endsWith(".jpg"))
    .sort();
  return files.map((f) => join(outDir, f));
}

async function framesToDataUrls(framePaths: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const p of framePaths) {
    const buf = await readFile(p);
    urls.push(`data:image/jpeg;base64,${buf.toString("base64")}`);
  }
  return urls;
}

/**
 * 主入口：对一个生成完成的视频（http(s) URL 或本地文件路径）跑「抽帧 + 文字检测」门禁。
 * 永不 throw：所有内部错误 → fail-open（checked=false）。
 */
export async function runFrameTextQa(
  videoUrlOrPath: string,
  opts?: { frameCount?: number },
): Promise<FrameQaVerdict> {
  if (!isFrameQaEnabled()) return skipVerdict("门禁未启用（mock 模式或未配置）");
  const isRemote = /^https?:\/\//i.test(videoUrlOrPath ?? "");
  const isLocal = !isRemote && !!videoUrlOrPath && existsSync(videoUrlOrPath);
  if (!isRemote && !isLocal) {
    return skipVerdict("视频 URL 不可下载");
  }

  const frameCount = opts?.frameCount ?? DEFAULT_FRAME_COUNT;
  let workDir: string | null = null;

  const gate = (async (): Promise<FrameQaVerdict> => {
    workDir = await mkdtemp(join(tmpdir(), "frame-qa-"));
    let videoPath = videoUrlOrPath;
    if (isRemote) {
      videoPath = join(workDir, "input.mp4");
      const res = await fetch(videoUrlOrPath);
      if (!res.ok) throw new Error(`下载视频失败 HTTP ${res.status}`);
      await writeFile(videoPath, Buffer.from(await res.arrayBuffer()));
    }

    const framePaths = await extractFrames(videoPath, workDir, frameCount);
    if (framePaths.length === 0) throw new Error("抽帧结果为空");

    const dataUrls = await framesToDataUrls(framePaths);
    const { data } = await analyzeImages(
      dataUrls,
      FRAME_QA_SYSTEM,
      `These are ${framePaths.length} frames sampled evenly from one AI-generated video. Inspect each frame for burned-in text per the policy and respond with the JSON envelope.`,
    );

    const findings = Array.isArray((data as { frames?: unknown }).frames)
      ? ((data as { frames: RawFrameFinding[] }).frames)
      : [];
    if (findings.length === 0) throw new Error("vision 返回缺少 frames 数组");

    return decideVerdict(findings, framePaths.length);
  })();

  try {
    return await Promise.race([
      gate,
      new Promise<FrameQaVerdict>((resolve) =>
        setTimeout(
          () => resolve(skipVerdict(`门禁超时（>${GATE_TIMEOUT_MS / 1000}s）`)),
          GATE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    return skipVerdict(`门禁执行异常：${(err as Error).message}`);
  } finally {
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** 供 errorMessage 前缀识别「frame-qa 拦截」的失败（重试时需强制重新生成） */
export const FRAME_QA_ERROR_PREFIX = "[frame-qa]";

export const __test__ = { decideVerdict, skipVerdict, FRAME_QA_SYSTEM };
