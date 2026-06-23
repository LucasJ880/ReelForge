/**
 * 拼接 Aivora 宠物套件讲解视频成片。
 *
 * 流程：下载各段 → 归一化到 1920x1080/30fps → 烧录中文字幕(drawtext) →
 *       concat 拼接 → 可选叠加 BGM。
 *
 * 用法：
 *   npm run demo:stitch:petkit
 *   PET_WALKTHROUGH_BGM=/abs/bgm.mp3 npm run demo:stitch:petkit   # 叠加 BGM
 *   UPLOAD_PETKIT_TO_BLOB=true npm run demo:stitch:petkit         # 同时上传 Blob
 *
 * 中文字体默认 /System/Library/Fonts/PingFang.ttc，可用 PET_CAPTION_FONT 覆盖。
 * 成片：public/generated/aivora-pet-content-kit-walkthrough-60s-16x9.mp4
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

loadEnvConfig(process.cwd());

const WORK_DIR = resolve(process.cwd(), "tmp/pet-kit-walkthrough-video");
const SEGMENT_DIR = resolve(WORK_DIR, "segments");
const NORMALIZED_DIR = resolve(WORK_DIR, "normalized");
const CAPTION_DIR = resolve(WORK_DIR, "captions");
const SUBMISSION_PATH = resolve(WORK_DIR, "submission.json");
const CONCAT_LIST_PATH = resolve(WORK_DIR, "concat-list.txt");
const CONCAT_OUTPUT_PATH = resolve(WORK_DIR, "concat-no-bgm.mp4");
const PUBLIC_OUTPUT_DIR = resolve(process.cwd(), "public/generated");
const FINAL_OUTPUT_PATH = resolve(
  PUBLIC_OUTPUT_DIR,
  "aivora-pet-content-kit-walkthrough-60s-16x9.mp4",
);
const CAPTION_RENDERER = resolve(process.cwd(), "scripts/render-caption-png.py");
// 随仓库内置的默认 BGM（"Wholesome" by Kevin MacLeod, CC BY 4.0）。
const DEFAULT_BGM_PATH = resolve(process.cwd(), "scripts/assets/pet-kit-bgm.mp3");

// 输出分辨率：对齐 Seedance 720p 源素材，避免无谓上采样、显著加速编码。
const OUT_W = 1280;
const OUT_H = 720;

// 视频编码：默认走 macOS 硬件编码器 h264_videotoolbox（远快于 libx264 medium）。
// 设置 PET_USE_X264=true 可回退到 libx264（跨平台、无硬件加速时使用）。
const VIDEO_ENCODE_ARGS = isTruthy(process.env.PET_USE_X264)
  ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
  : ["-c:v", "h264_videotoolbox", "-b:v", "6M", "-pix_fmt", "yuv420p"];

const DEFAULT_FONT_CANDIDATES = [
  process.env.PET_CAPTION_FONT,
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/System/Library/Fonts/Supplemental/Songti.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
].filter(Boolean) as string[];

type SubmissionRecord = {
  segments: Array<{
    index: number;
    caption: string;
    videoUrl?: string;
  }>;
};

async function main() {
  ensureTools();
  ensureDir(SEGMENT_DIR);
  ensureDir(NORMALIZED_DIR);
  ensureDir(CAPTION_DIR);
  ensureDir(PUBLIC_OUTPUT_DIR);

  const font = resolveFont();
  const segments = readSegments();

  banner("准备各段输入");
  const localInputs: Array<{ path: string; caption: string; index: number }> = [];
  for (const segment of segments) {
    const localPath = await prepareInput(segment.videoUrl as string, segment.index);
    localInputs.push({ path: localPath, caption: segment.caption, index: segment.index });
    console.log(`segment ${segment.index} input = ${localPath}`);
  }

  banner("归一化 + 烧录中文字幕");
  const normalizedPaths = localInputs.map((input) => {
    const out = resolve(NORMALIZED_DIR, `segment-${input.index}.mp4`);
    normalizeAndCaption(input.path, out, input.caption, input.index, font);
    console.log(`segment ${input.index} normalized = ${out}`);
    return out;
  });

  banner("拼接片段");
  writeConcatList(normalizedPaths);
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", CONCAT_LIST_PATH, "-c", "copy", CONCAT_OUTPUT_PATH],
    { stdio: "inherit" },
  );

  const bgm = resolveBgm();
  const totalSec = probeDurationSec(CONCAT_OUTPUT_PATH);
  const voiceover = resolveVoiceover(normalizedPaths.length, normalizedPaths);

  if (voiceover.length > 0) {
    banner("混音：中文配音旁白（主） + 压低 BGM（垫底）");
    mixVoiceoverAndBgm({ voiceover, bgm, totalSec });
    console.log(
      `voiceover segments = ${voiceover.map((v) => v.index).join(",")}`,
      bgm ? `| bgm = ${bgm}` : "| 无 BGM",
    );
  } else if (bgm) {
    banner("叠加 BGM（无配音旁白）");
    const fadeOutStart = Math.max(0, totalSec - 2);
    // 可调整整体音量（默认 0.85，给「字幕承载信息」留出克制感）。
    const gain = readBgmGain(0.85);
    // -stream_loop -1 让较短的 BGM 自动循环铺满整支视频；
    // atrim 精确截到视频时长，再做整体淡入淡出，避免循环接缝处突兀。
    const audioFilter = [
      "aformat=sample_rates=44100:channel_layouts=stereo",
      `atrim=0:${totalSec.toFixed(2)}`,
      "loudnorm=I=-18:TP=-1.5:LRA=11",
      `volume=${gain}`,
      "afade=t=in:st=0:d=1.2",
      `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2`,
    ].join(",");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        CONCAT_OUTPUT_PATH,
        "-stream_loop",
        "-1",
        "-i",
        bgm,
        "-filter_complex",
        `[1:a]${audioFilter}[a]`,
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-shortest",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        FINAL_OUTPUT_PATH,
      ],
      { stdio: "inherit" },
    );
    console.log("bgm =", bgm, "| gain =", gain);
  } else {
    console.log("未提供配音旁白与 BGM，输出无声版本。");
    execFileSync("ffmpeg", ["-y", "-i", CONCAT_OUTPUT_PATH, "-c", "copy", FINAL_OUTPUT_PATH], {
      stdio: "inherit",
    });
  }

  console.log("finalLocalPath =", FINAL_OUTPUT_PATH);
  console.log("publicUrl =", "/generated/aivora-pet-content-kit-walkthrough-60s-16x9.mp4");

  if (isTruthy(process.env.UPLOAD_PETKIT_TO_BLOB)) {
    const url = await uploadToBlob(FINAL_OUTPUT_PATH);
    console.log("finalBlobUrl =", url);
    console.log("把该 URL 填入 PET_WALKTHROUGH_VIDEO_URL。");
  } else {
    console.log(
      "把 /generated/aivora-pet-content-kit-walkthrough-60s-16x9.mp4 填入 src/lib/demo/pet-content-kit-demo-data.ts 的 PET_WALKTHROUGH_VIDEO_URL。",
    );
  }
}

function readSegments() {
  if (!existsSync(SUBMISSION_PATH)) {
    throw new Error(
      [
        `缺少提交记录：${SUBMISSION_PATH}`,
        "请先：npm run demo:gen:petkit && npm run demo:check:petkit",
      ].join("\n"),
    );
  }
  const record = JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;
  const segments = [...record.segments].sort((a, b) => a.index - b.index);
  const missing = segments.filter((segment) => !segment.videoUrl);
  if (segments.length !== 4 || missing.length > 0) {
    throw new Error(
      [
        "提交记录里没有 4 段完整的 videoUrl。",
        "请先：npm run demo:check:petkit（全部完成后再拼接）。",
      ].join("\n"),
    );
  }
  return segments;
}

async function prepareInput(input: string, index: number) {
  if (isRemoteUrl(input)) {
    const out = resolve(SEGMENT_DIR, `segment-${index}-source.mp4`);
    // 复用已下载的源，避免每次拼接都重新拉取（Seedance URL 24h 内有效）。
    if (
      existsSync(out) &&
      statSync(out).size > 0 &&
      !isTruthy(process.env.PETKIT_FORCE_REDOWNLOAD)
    ) {
      return out;
    }
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(
        `下载第 ${index} 段失败：${response.status} ${response.statusText}`,
      );
    }
    writeFileSync(out, Buffer.from(await response.arrayBuffer()));
    return out;
  }
  const local = input.startsWith("file://") ? input.slice("file://".length) : input;
  const resolved = isAbsolute(local) ? local : resolve(process.cwd(), local);
  if (!existsSync(resolved)) throw new Error(`第 ${index} 段文件不存在：${resolved}`);
  return resolved;
}

function normalizeAndCaption(
  input: string,
  output: string,
  caption: string,
  index: number,
  font: string,
) {
  const captionFile = resolve(CAPTION_DIR, `caption-${index}.txt`);
  writeFileSync(captionFile, caption, "utf8");

  // 本机 ffmpeg 未编译 libfreetype（drawtext 不可用），改为 PIL 渲染字幕 PNG
  // 再用核心 overlay 滤镜叠加，保证中文字幕正确显示。
  const captionPng = resolve(CAPTION_DIR, `caption-${index}.png`);
  execFileSync(
    "python3",
    [CAPTION_RENDERER, font, captionFile, captionPng, `${OUT_W}`, `${OUT_H}`, "0"],
    { stdio: "inherit" },
  );

  const filterComplex = [
    `[0:v]fps=30,scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,` +
      `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[base]`,
    "[base][1:v]overlay=0:0:format=auto[v]",
  ].join(";");

  // 用源时长显式限定输出长度，避免 looped 字幕图 + anullsrc 导致 -shortest 不终止。
  const durationSec = probeDurationSec(input);

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      input,
      "-loop",
      "1",
      "-i",
      captionPng,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex",
      filterComplex,
      "-map",
      "[v]",
      "-map",
      "2:a:0",
      "-t",
      durationSec.toFixed(2),
      ...VIDEO_ENCODE_ARGS,
      "-c:a",
      "aac",
      "-ar",
      "44100",
      "-ac",
      "2",
      output,
    ],
    { stdio: "inherit" },
  );
}

function probeDurationSec(input: string) {
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nokey=1:noprint_wrappers=1",
    input,
  ]).toString("utf8");
  const parsed = Number(out.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

function writeConcatList(paths: string[]) {
  const body = paths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(CONCAT_LIST_PATH, `${body}\n`, "utf8");
}

function resolveFont() {
  const found = DEFAULT_FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      [
        "找不到可用的中文字体用于烧录字幕。",
        "请设置 PET_CAPTION_FONT 指向一个支持中文的字体文件（.ttf/.ttc/.otf）。",
        `已尝试：${DEFAULT_FONT_CANDIDATES.join(", ")}`,
      ].join("\n"),
    );
  }
  console.log("captionFont =", found);
  return found;
}

function readBgmGain(fallback: number) {
  const raw = process.env.PET_WALKTHROUGH_BGM_GAIN;
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const VOICEOVER_DIR = resolve(WORK_DIR, "voiceover");

type VoiceoverClip = { index: number; path: string; offsetSec: number };

/**
 * 读取已生成的中文配音旁白（vo-{index}.mp3），并按各段在成片中的起始
 * 时间计算偏移，供 mix 阶段用 adelay 精确对齐到对应分镜。
 */
function resolveVoiceover(count: number, normalizedPaths: string[]): VoiceoverClip[] {
  if (!existsSync(VOICEOVER_DIR)) return [];
  if (isTruthy(process.env.PET_DISABLE_VOICEOVER)) return [];

  // 各段在成片里的起始秒数 = 前面所有段时长之和。
  const segDurations = normalizedPaths.map((p) => probeDurationSec(p));
  const offsets: number[] = [];
  let acc = 0;
  for (const d of segDurations) {
    offsets.push(acc);
    acc += d;
  }

  const clips: VoiceoverClip[] = [];
  for (let i = 1; i <= count; i++) {
    const path = resolve(VOICEOVER_DIR, `vo-${i}.mp3`);
    if (existsSync(path) && statSync(path).size > 0) {
      clips.push({ index: i, path, offsetSec: offsets[i - 1] ?? 0 });
    }
  }
  return clips;
}

/**
 * 把配音旁白（主声轨）与 BGM（压低垫底）混入成片：
 *  - 每段旁白用 adelay 对齐到对应分镜起点；
 *  - BGM 循环铺满、loudnorm 后压到很低音量，仅作氛围垫底；
 *  - 末端 alimiter 防止叠加削顶。
 */
function mixVoiceoverAndBgm(opts: {
  voiceover: VoiceoverClip[];
  bgm: string | null;
  totalSec: number;
}) {
  const { voiceover, bgm, totalSec } = opts;
  const fadeOutStart = Math.max(0, totalSec - 2);
  // 旁白整体音量（可用 PET_VOICEOVER_GAIN 微调）。
  const voGain = readPositiveEnv(process.env.PET_VOICEOVER_GAIN, 1.15);
  // 有旁白时 BGM 默认压到很低，避免盖住人声。
  const bgGain = bgm ? readBgmGain(0.16) : 0;

  const inputs: string[] = ["-i", CONCAT_OUTPUT_PATH];
  voiceover.forEach((clip) => {
    inputs.push("-i", clip.path);
  });
  if (bgm) {
    inputs.push("-stream_loop", "-1", "-i", bgm);
  }

  const filterParts: string[] = [];
  const voLabels: string[] = [];
  voiceover.forEach((clip, idx) => {
    const ff = idx + 1; // ffmpeg 输入序号（0 是视频）
    const delayMs = Math.round(clip.offsetSec * 1000);
    const label = `vo${idx}`;
    filterParts.push(
      `[${ff}:a]aresample=44100,aformat=channel_layouts=stereo,` +
        `adelay=${delayMs}|${delayMs}[${label}]`,
    );
    voLabels.push(`[${label}]`);
  });

  // 合并所有旁白片段为一条人声轨（不重叠，normalize=0 保持各自音量）。
  if (voLabels.length === 1) {
    filterParts.push(`${voLabels[0]}volume=${voGain}[voice]`);
  } else {
    filterParts.push(
      `${voLabels.join("")}amix=inputs=${voLabels.length}:normalize=0,` +
        `volume=${voGain}[voice]`,
    );
  }
  const voiceMix = "[voice]";

  let finalAudio: string;
  if (bgm) {
    const bgIdx = voiceover.length + 1;
    filterParts.push(
      `[${bgIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,` +
        `atrim=0:${totalSec.toFixed(2)},loudnorm=I=-20:TP=-2:LRA=11,` +
        `volume=${bgGain},afade=t=in:st=0:d=1.2,` +
        `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2[bg]`,
    );
    filterParts.push(
      `${voiceMix}[bg]amix=inputs=2:normalize=0,alimiter=limit=0.95[mix]`,
    );
    finalAudio = "[mix]";
  } else {
    filterParts.push(`${voiceMix}alimiter=limit=0.95[mix]`);
    finalAudio = "[mix]";
  }

  execFileSync(
    "ffmpeg",
    [
      "-y",
      ...inputs,
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "0:v:0",
      "-map",
      finalAudio,
      "-t",
      totalSec.toFixed(2),
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      FINAL_OUTPUT_PATH,
    ],
    { stdio: "inherit" },
  );

  console.log("voiceGain =", voGain, "| bgGain =", bgGain);
}

function readPositiveEnv(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveBgm() {
  const raw = process.env.PET_WALKTHROUGH_BGM;
  // 设置 PET_WALKTHROUGH_BGM=none 可强制输出无配乐版本。
  if (raw === "none") return null;
  if (raw) {
    const resolved = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
    if (!existsSync(resolved)) {
      throw new Error(`PET_WALKTHROUGH_BGM 指向的文件不存在：${resolved}`);
    }
    return resolved;
  }
  // 未显式指定时，使用随仓库内置的默认 BGM
  // （"Wholesome" by Kevin MacLeod, incompetech.com, CC BY 4.0）。
  if (existsSync(DEFAULT_BGM_PATH)) return DEFAULT_BGM_PATH;
  return null;
}

async function uploadToBlob(path: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("UPLOAD_PETKIT_TO_BLOB=true 需要 BLOB_READ_WRITE_TOKEN。");
  }
  const { put } = await import("@vercel/blob");
  const blob = await put(`generated/${basename(path)}`, readFileSync(path), {
    access: "public",
    contentType: "video/mp4",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

function ensureTools() {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function isRemoteUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isTruthy(value?: string) {
  const normalized = value?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

main().catch((err) => {
  console.error("\n宠物套件讲解视频拼接失败：");
  console.error((err as Error).message);
  process.exit(1);
});
