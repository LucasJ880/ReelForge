/**
 * ffmpeg 二进制与调用的唯一入口（4.1 / D2）。
 *
 * 背景：生产 Vercel 函数没有系统 ffmpeg。帧质检、品牌封装此前直接
 * spawn("ffmpeg"/"ffprobe")，线上必然 ENOENT —— 帧质检 fail-open 静默放行、
 * 品牌封装直接失败。本轮把 ffmpeg-static 的单个 linux-x64 二进制按路由精确
 * 打进需要它的函数（next.config.ts outputFileTracingIncludes），这里负责在
 * 运行时找到它，并给所有调用统一注入字体环境（FONTCONFIG_FILE）。
 *
 * 解析顺序：
 *   1. FFMPEG_BIN 环境变量（显式覆盖：本机 Homebrew / Docker apt / 运维临时切换）
 *   2. ffmpeg-static 静态二进制：从 cwd 起逐级向上找 node_modules/ffmpeg-static/ffmpeg
 *      （与运行时 require.resolve 的查找规则一致；Vercel 上即 /var/task/node_modules/…）
 *   3. PATH 上的 `ffmpeg`
 *
 * 刻意不 `import "ffmpeg-static"`：那会让文件追踪把 ~80MB 的二进制带进每一个
 * 间接引用 stitch-service 的函数。二进制只经 outputFileTracingIncludes 进 4 个函数。
 *
 * ffmpeg-static 不带 ffprobe —— 时长 / 尺寸 / 帧率 / 有无音轨统一用
 * `ffmpeg -i` 的输入信息解析（probeMedia），函数运行时不再依赖 ffprobe。
 *
 * GitHub Actions 拼接 runner（scripts/stitch-runner.ts）不引用本模块，继续用 apt ffmpeg。
 */

import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { mediaProcessEnv } from "./media-fonts";

export type FfmpegBinarySource = "env" | "ffmpeg-static" | "path";

export interface ResolvedFfmpegBinary {
  path: string;
  source: FfmpegBinarySource;
}

const FFMPEG_STATIC_PACKAGE = "ffmpeg-static";
const STATIC_BINARY_NAME = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

function defaultIsExecutable(candidate: string): boolean {
  try {
    accessSync(/*turbopackIgnore: true*/ candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/// 向上找 node_modules 的层数（与 require.resolve 的查找规则一致，够覆盖提升安装）
const MAX_NODE_MODULES_LOOKUP_DEPTH = 6;

/**
 * ffmpeg-static 二进制的候选位置（不保证存在）。
 *
 * 等价于运行时 require.resolve("ffmpeg-static") 的目录查找：从 cwd 起逐级向上找
 * node_modules/ffmpeg-static/ffmpeg。刻意不用 createRequire —— Turbopack 会把
 * 「从动态路径创建的 require」当成任意模块加载，把整个项目追进函数（4.7 实测
 * ~180MB，叠加二进制后超过 250MB 上限）。路径全部带 turbopackIgnore：只在运行时
 * 解析，二进制由 next.config.ts 的 outputFileTracingIncludes 精确打进需要的函数。
 */
export function staticFfmpegCandidates(
  cwd: string = /*turbopackIgnore: true*/ process.cwd(),
): string[] {
  const candidates: string[] = [];
  let dir = path.resolve(/*turbopackIgnore: true*/ cwd);
  for (let depth = 0; depth < MAX_NODE_MODULES_LOOKUP_DEPTH; depth += 1) {
    candidates.push(
      path.join(
        /*turbopackIgnore: true*/ dir,
        "node_modules",
        FFMPEG_STATIC_PACKAGE,
        STATIC_BINARY_NAME,
      ),
    );
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates;
}

export function resolveFfmpegBinary(
  opts: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    isExecutable?: (candidate: string) => boolean;
  } = {},
): ResolvedFfmpegBinary {
  const env = opts.env ?? process.env;
  const explicit = env.FFMPEG_BIN?.trim();
  if (explicit) return { path: explicit, source: "env" };
  const isExecutable = opts.isExecutable ?? defaultIsExecutable;
  for (const candidate of staticFfmpegCandidates(opts.cwd)) {
    if (isExecutable(candidate)) return { path: candidate, source: "ffmpeg-static" };
  }
  return { path: "ffmpeg", source: "path" };
}

let cached: { key: string; binary: ResolvedFfmpegBinary } | null = null;

/** 当前进程使用的 ffmpeg（按 FFMPEG_BIN 取值缓存，测试改 env 后自动失效） */
export function ffmpegBinary(): ResolvedFfmpegBinary {
  const key = process.env.FFMPEG_BIN ?? "";
  if (!cached || cached.key !== key) {
    cached = { key, binary: resolveFfmpegBinary() };
  }
  return cached.binary;
}

export function ffmpegBin(): string {
  return ffmpegBinary().path;
}

export interface FfmpegRunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  /**
   * true = 非 0 退出码也视为「跑完了」并返回 stdout/stderr。
   * 用于 `ffmpeg -i <file>`（没有输出文件时必然以 1 退出）这类只读输出信息的调用。
   * 超时 / 被杀 / 找不到二进制仍然 reject。
   */
  allowNonZeroExit?: boolean;
}

export interface FfmpegRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/// 刻意走 promisify 包装：Turbopack 会把裸 `execFile(<动态命令>, <动态参数>)` 当成
/// 可能的 `node <script>` 调用，按参数去追整个项目（4.7 实测函数 ~180MB）。
const execFileAsync = promisify(execFile);

type ExecFailure = Error & {
  code?: number | string;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
};

/**
 * 跑一次 ffmpeg：统一二进制解析 + 字体环境。失败时 reject 的 Error 与
 * promisify(execFile) 一致（message 带 stderr，error.stdout / error.stderr 可取），
 * 调用方原有的错误拼接不变。
 */
export async function runFfmpeg(
  args: string[],
  opts: FfmpegRunOptions = {},
): Promise<FfmpegRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(ffmpegBin(), args, {
      env: mediaProcessEnv(),
      timeout: opts.timeoutMs ?? 0,
      maxBuffer: opts.maxBuffer ?? 1024 * 1024 * 16,
      windowsHide: true,
      encoding: "utf8",
    });
    return { stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: 0 };
  } catch (error) {
    const failure = error as ExecFailure;
    if (
      opts.allowNonZeroExit &&
      typeof failure.code === "number" &&
      !failure.killed &&
      !failure.signal
    ) {
      return {
        stdout: String(failure.stdout ?? ""),
        stderr: String(failure.stderr ?? ""),
        exitCode: failure.code,
      };
    }
    throw error;
  }
}

/** `ffmpeg -version` 第一行；二进制不可用时 reject */
export async function ffmpegVersion(timeoutMs = 8_000): Promise<string> {
  const { stdout } = await runFfmpeg(["-hide_banner", "-version"], { timeoutMs });
  return stdout.split("\n")[0]?.trim() ?? "";
}

// ---------- 媒体探测（替代 ffprobe） ----------

export interface MediaProbe {
  /** 容器时长（秒）；直播流 / 无法得知时为 null */
  durationSec: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  /** 源帧率（优先 tbr，即 ffprobe 的 r_frame_rate；其次平均 fps） */
  fps: number | null;
}

function parseRateToken(token: string | undefined): number | null {
  if (!token) return null;
  const match = /^(\d+(?:\.\d+)?)(k?)$/.exec(token.trim());
  if (!match) return null;
  const value = Number(match[1]) * (match[2] === "k" ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 纯函数：解析 `ffmpeg -i <file>` 打到 stderr 的输入信息（只看第一个输入 #0）。
 *
 *   Duration: 00:00:15.04, start: 0.000000, bitrate: 2141 kb/s
 *   Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(...), 720x1280 [SAR 1:1 DAR 9:16], 2008 kb/s, 24 fps, 24 tbr, 12288 tbn (default)
 *   Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)
 */
export function parseFfmpegInputInfo(stderr: string): MediaProbe {
  const probe: MediaProbe = {
    durationSec: null,
    hasVideo: false,
    hasAudio: false,
    width: null,
    height: null,
    fps: null,
  };
  /// 只解析 Input #0 段落：遇到 Input #1 / Output 就停
  const lines = stderr.split(/\r?\n/);
  let inFirstInput = false;
  for (const line of lines) {
    if (/^Input #0\b/.test(line)) {
      inFirstInput = true;
      continue;
    }
    if (inFirstInput && /^(Input #[1-9]|Output #|Stream mapping:)/.test(line)) break;
    if (!inFirstInput) continue;

    const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
    if (duration && probe.durationSec === null) {
      const seconds =
        Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      if (Number.isFinite(seconds) && seconds > 0) probe.durationSec = seconds;
      continue;
    }

    const stream = /^\s*Stream #0:\d+\S*: (Video|Audio): (.*)$/.exec(line);
    if (!stream) continue;
    if (stream[1] === "Audio") {
      probe.hasAudio = true;
      continue;
    }
    /// mp3/m4a 封面图也以 Video 流出现，不算视频
    if (/\(attached pic\)/.test(stream[2])) continue;
    if (probe.hasVideo) continue;
    probe.hasVideo = true;
    const desc = stream[2];
    const dims = /,\s*(\d{2,5})x(\d{2,5})(?=[\s,]|$)/.exec(desc);
    if (dims) {
      probe.width = Number(dims[1]);
      probe.height = Number(dims[2]);
    }
    const tbr = parseRateToken(/,\s*([\d.]+k?) tbr\b/.exec(desc)?.[1]);
    const fps = parseRateToken(/,\s*([\d.]+k?) fps\b/.exec(desc)?.[1]);
    probe.fps = tbr !== null && tbr <= 240 ? tbr : fps;
  }
  return probe;
}

/**
 * 探测本地媒体文件（替代 ffprobe）。文件不可读 / 不是媒体时 reject。
 */
export async function probeMedia(
  filePath: string,
  opts: { timeoutMs?: number } = {},
): Promise<MediaProbe> {
  const { stderr } = await runFfmpeg(
    ["-hide_banner", "-nostdin", "-i", filePath],
    { timeoutMs: opts.timeoutMs ?? 30_000, allowNonZeroExit: true },
  );
  if (!/^Input #0\b/m.test(stderr)) {
    const lastLine = stderr.trim().split(/\r?\n/).pop() ?? "";
    throw new Error(`ffmpeg probe failed: ${lastLine.slice(0, 300)}`);
  }
  return parseFfmpegInputInfo(stderr);
}

/** 时长探测：拿不到合法时长时 reject（与旧 ffprobe 包装的语义一致） */
export async function probeMediaDurationSeconds(
  filePath: string,
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  const probe = await probeMedia(filePath, opts);
  if (probe.durationSec === null || probe.durationSec <= 0) {
    throw new Error(`ffmpeg probe returned no duration for ${filePath}`);
  }
  return probe.durationSec;
}

export const __test__ = {
  resetCache() {
    cached = null;
  },
};
