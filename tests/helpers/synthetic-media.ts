/**
 * 合成器集成测试用的本地合成素材（lavfi 生成，不连任何供应商 / 对象存储 / 数据库）。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TestContext } from "node:test";
import { runFfmpeg } from "../../src/lib/media/ffmpeg-bin";
import { __test__ as fontsTest } from "../../src/lib/media/media-fonts";
import { getStorageProvider } from "../../src/lib/storage";

export async function ffmpegUsable(): Promise<boolean> {
  try {
    await runFfmpeg(["-hide_banner", "-version"], { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** 本机 ffmpeg 是否带 libass（ffmpeg-static 带；Homebrew 8.x 默认不带） */
export async function ffmpegHasLibass(): Promise<boolean> {
  try {
    const { stdout } = await runFfmpeg(["-hide_banner", "-filters"], { timeoutMs: 5_000 });
    return /\bass\b/.test(stdout);
  } catch {
    return false;
  }
}

export type SyntheticAudio =
  | { kind: "none" }
  /**
   * 正弦「口播」响到 speechSec，之后数字静音补到片长；
   * padToEnd=false 时音频流就在 speechSec 结束（音轨比画面短）。
   */
  | { kind: "tone"; hz: number; speechSec: number; padToEnd?: boolean };

export async function makeClip(
  file: string,
  opts: {
    width?: number;
    height?: number;
    fps?: number;
    durationSec: number;
    audio: SyntheticAudio;
    color?: string;
  },
): Promise<string> {
  const width = opts.width ?? 360;
  const height = opts.height ?? 640;
  const fps = opts.fps ?? 24;
  const args = [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    opts.color
      ? `color=c=${opts.color}:s=${width}x${height}:r=${fps}:d=${opts.durationSec}`
      : `testsrc2=s=${width}x${height}:r=${fps}:d=${opts.durationSec}`,
  ];
  const padToEnd = opts.audio.kind === "tone" && opts.audio.padToEnd !== false;
  if (opts.audio.kind === "tone") {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${opts.audio.hz}:sample_rate=44100:duration=${opts.audio.speechSec}`,
      ...(padToEnd ? ["-af", `apad=whole_dur=${opts.durationSec}`] : []),
      "-c:a",
      "aac",
      "-ac",
      "2",
    );
  }
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
  if (padToEnd) args.push("-shortest");
  args.push(file);
  await runFfmpeg(args, { timeoutMs: 60_000 });
  return file;
}

/** 只有音轨的文件（b-roll TTS 替身） */
export async function makeTone(file: string, hz: number, durationSec: number): Promise<string> {
  await runFfmpeg(
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${hz}:sample_rate=44100:duration=${durationSec}`,
      "-c:a",
      "aac",
      "-ac",
      "2",
      file,
    ],
    { timeoutMs: 30_000 },
  );
  return file;
}

export const fileUrl = (file: string) => pathToFileURL(file).href;

/** 内存版对象存储：上传内容落到本地目录，返回 file:// URL */
export function installMemoryStorage(t: TestContext, dir: string) {
  const storage = getStorageProvider() as unknown as Record<string, unknown>;
  const original = { isConfigured: storage.isConfigured, uploadBuffer: storage.uploadBuffer };
  const uploads: Array<{ key: string; file: string; contentType?: string; bytes: number }> = [];
  storage.isConfigured = () => true;
  storage.uploadBuffer = async (
    _bucket: string,
    buffer: Buffer,
    options: { key: string; contentType?: string },
  ) => {
    const out = path.join(dir, `upload-${uploads.length}-${path.basename(options.key)}`);
    writeFileSync(out, buffer);
    uploads.push({ key: options.key, file: out, contentType: options.contentType, bytes: buffer.length });
    return { url: pathToFileURL(out).href, key: options.key, absolute: false };
  };
  t.after(() => {
    storage.isConfigured = original.isConfigured;
    storage.uploadBuffer = original.uploadBuffer;
  });
  return uploads;
}

/**
 * 字幕烧录需要打包的 Noto Sans SC：主仓库 node_modules 里有；工作树 / CI 子目录跑测试时
 * cwd 下找不到，显式指给 media-fonts。
 */
export function useBundledCjkFont(t: TestContext): boolean {
  let fontFile: string;
  try {
    fontFile = require.resolve(
      "@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf",
    );
  } catch {
    return false;
  }
  const env = process.env as Record<string, string | undefined>;
  const previous = env.MEDIA_CJK_FONT_FILE;
  env.MEDIA_CJK_FONT_FILE = fontFile;
  fontsTest.resetCache();
  t.after(() => {
    if (previous === undefined) delete env.MEDIA_CJK_FONT_FILE;
    else env.MEDIA_CJK_FONT_FILE = previous;
    fontsTest.resetCache();
  });
  return true;
}

/** 某个频率附近的平均能量（dB）：用来判断成片里保住的是哪条音轨 */
export async function toneMeanVolumeDb(
  file: string,
  hz: number,
  opts: { fromSec?: number; durationSec?: number } = {},
): Promise<number | null> {
  const result = await runFfmpeg(
    [
      "-hide_banner",
      "-nostats",
      ...(opts.fromSec ? ["-ss", String(opts.fromSec)] : []),
      ...(opts.durationSec ? ["-t", String(opts.durationSec)] : []),
      "-i",
      file,
      "-vn",
      "-af",
      `bandpass=f=${hz}:width_type=h:w=40,volumedetect`,
      "-f",
      "null",
      "-",
    ],
    { timeoutMs: 30_000, allowNonZeroExit: true },
  );
  const match = /mean_volume: (-?[\d.]+) dB/.exec(result.stderr);
  return match ? Number(match[1]) : null;
}
