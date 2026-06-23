/**
 * 拼接 Aivora 宠物套件讲解视频成片（纯音乐版 · 渲染图 × 真实画面交替剪辑）。
 *
 * 创意方向（已锁定）：「价值时刻 × 产品」交替剪辑——每个真实宠物画面（讲价值）
 * 紧跟一个对应设备的精修产品渲染图（讲靠哪个硬件实现），产品始终出现在它创造
 * 价值的语境里。全程纯音乐 + 中文字幕，不再有 AI 配音旁白。
 *
 * 9 段分镜（约 58s，16:9）：
 *   1. 全家福渲染图（开场揭幕）
 *   2. Seedance① 家中宠物日常
 *   3. 360° 摄像头渲染图
 *   4. Seedance② 高光可爱瞬间
 *   5. 第一视角项圈渲染图
 *   6. Seedance③ 手机播放成片 + 宠物日记
 *   7. 智能宠物垫渲染图
 *   8. Seedance④ 分享裂变 montage
 *   9. 信息图海报（收尾）
 *
 * 流程：渲染图 → Ken Burns 镜头clip（ffmpeg zoompan）；Seedance 源 → 归一化 + 裁到约 9s；
 *       统一烧录中文字幕 → 按分镜顺序 concat → 叠加 BGM（纯音乐）。
 *
 * 用法：
 *   npm run demo:stitch:petkit
 *   PET_WALKTHROUGH_BGM=/abs/bgm.mp3 npm run demo:stitch:petkit   # 自定义 BGM
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
const RENDER_DIR = resolve(process.cwd(), "public/demo/pet");
// 随仓库内置的默认 BGM（"Wholesome" by Kevin MacLeod, CC BY 4.0）。
const DEFAULT_BGM_PATH = resolve(process.cwd(), "scripts/assets/pet-kit-bgm.mp3");

// 输出分辨率：对齐 Seedance 720p 源素材。
const OUT_W = 1280;
const OUT_H = 720;
const FPS = 30;

// 视频编码：默认走 macOS 硬件编码器 h264_videotoolbox（远快于 libx264）。
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

/** 渲染图镜头（Ken Burns）。 */
type RenderClip = {
  kind: "render";
  id: string;
  image: string;
  caption: string;
  durationSec: number;
};

/** Seedance 真实画面（归一化 + 裁切）。 */
type SeedanceClip = {
  kind: "seedance";
  id: string;
  sourceIndex: number;
  caption: string;
  trimStartSec: number;
  durationSec: number;
};

type StoryboardClip = RenderClip | SeedanceClip;

/** 9 段分镜：渲染图与真实画面交替，把产品焊进它创造价值的语境。 */
const STORYBOARD: StoryboardClip[] = [
  {
    kind: "render",
    id: "01-kit-open",
    image: "kit-group.png",
    caption: "Aivora · 宠物内容智能采集套件",
    durationSec: 6,
  },
  {
    kind: "seedance",
    id: "02-life",
    sourceIndex: 1,
    caption: "真实瞬间，自动被记录",
    trimStartSec: 2.5,
    durationSec: 9,
  },
  {
    kind: "render",
    id: "03-cam360",
    image: "cam-360.png",
    caption: "360° AI 追踪，不打扰地捕捉",
    durationSec: 3.5,
  },
  {
    kind: "seedance",
    id: "04-highlight",
    sourceIndex: 2,
    caption: "AI 自动挑出最可爱、最值得分享的片段",
    trimStartSec: 2.5,
    durationSec: 9,
  },
  {
    kind: "render",
    id: "05-collar",
    image: "collar-cam.png",
    caption: "第一视角，记录它眼里的世界",
    durationSec: 3.5,
  },
  {
    kind: "seedance",
    id: "06-autoclip",
    sourceIndex: 3,
    caption: "一键生成可爱视频和宠物日记",
    trimStartSec: 2.5,
    durationSec: 9,
  },
  {
    kind: "render",
    id: "07-mat",
    image: "smart-mat.png",
    caption: "真实使用，成为品牌可信证据",
    durationSec: 3.5,
  },
  {
    kind: "seedance",
    id: "08-share",
    sourceIndex: 4,
    caption: "分享带来增长，真实使用成为品牌证据",
    trimStartSec: 2.5,
    durationSec: 9,
  },
  {
    kind: "render",
    id: "09-poster-close",
    image: "hardware-kit-poster.png",
    caption: "把真实宠物瞬间，变成可分享内容与品牌证据",
    durationSec: 6,
  },
];

async function main() {
  ensureTools();
  ensureDir(SEGMENT_DIR);
  ensureDir(NORMALIZED_DIR);
  ensureDir(CAPTION_DIR);
  ensureDir(PUBLIC_OUTPUT_DIR);

  const font = resolveFont();
  const seedanceSegments = readSegments();
  const seedanceByIndex = new Map(seedanceSegments.map((s) => [s.index, s]));

  banner("逐段生成归一化片段（渲染图 Ken Burns + Seedance 裁切）");
  const normalizedPaths: string[] = [];
  for (const clip of STORYBOARD) {
    const out = resolve(NORMALIZED_DIR, `clip-${clip.id}.mp4`);
    if (clip.kind === "render") {
      buildRenderClip(clip, out, font);
    } else {
      const seg = seedanceByIndex.get(clip.sourceIndex);
      if (!seg?.videoUrl) {
        throw new Error(`缺少 Seedance 第 ${clip.sourceIndex} 段的 videoUrl。`);
      }
      const localPath = await prepareInput(seg.videoUrl, clip.sourceIndex);
      buildSeedanceClip(clip, localPath, out, font);
    }
    console.log(`clip ${clip.id} (${clip.kind}) = ${out}`);
    normalizedPaths.push(out);
  }

  banner("拼接片段");
  writeConcatList(normalizedPaths);
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", CONCAT_LIST_PATH, "-c", "copy", CONCAT_OUTPUT_PATH],
    { stdio: "inherit" },
  );

  const bgm = resolveBgm();
  const totalSec = probeDurationSec(CONCAT_OUTPUT_PATH);

  if (bgm) {
    banner("叠加纯音乐 BGM（无配音旁白）");
    addBgmOnly({ bgm, totalSec });
    console.log("bgm =", bgm);
  } else {
    console.log("未提供 BGM，输出无声版本。");
    execFileSync("ffmpeg", ["-y", "-i", CONCAT_OUTPUT_PATH, "-c", "copy", FINAL_OUTPUT_PATH], {
      stdio: "inherit",
    });
  }

  console.log("totalSec ≈", totalSec.toFixed(1));
  console.log("finalLocalPath =", FINAL_OUTPUT_PATH);
  console.log("publicUrl =", "/generated/aivora-pet-content-kit-walkthrough-60s-16x9.mp4");

  if (isTruthy(process.env.UPLOAD_PETKIT_TO_BLOB)) {
    const url = await uploadToBlob(FINAL_OUTPUT_PATH);
    console.log("finalBlobUrl =", url);
    console.log("把该 URL 填入 PET_WALKTHROUGH_VIDEO_URL。");
  } else {
    console.log(
      "成片已覆盖 public/generated/aivora-pet-content-kit-walkthrough-60s-16x9.mp4（demo 已指向该路径）。",
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

/** 渲染一张全屏透明字幕 PNG（PIL），返回路径。 */
function renderCaptionPng(caption: string, id: string, font: string) {
  const captionFile = resolve(CAPTION_DIR, `caption-${id}.txt`);
  const captionPng = resolve(CAPTION_DIR, `caption-${id}.png`);
  writeFileSync(captionFile, caption, "utf8");
  execFileSync(
    "python3",
    [CAPTION_RENDERER, font, captionFile, captionPng, `${OUT_W}`, `${OUT_H}`, "0"],
    { stdio: "inherit" },
  );
  return captionPng;
}

/**
 * 把一张产品渲染图做成带缓慢推镜（Ken Burns）的 16:9 clip，并烧录字幕。
 * 4:3 渲染图会被居中放大裁切到 16:9（产品居中、留白充足，裁切不影响主体）。
 */
function buildRenderClip(clip: RenderClip, output: string, font: string) {
  const captionPng = renderCaptionPng(clip.caption, clip.id, font);
  const image = resolve(RENDER_DIR, clip.image);
  if (!existsSync(image)) throw new Error(`渲染图不存在：${image}`);

  const frames = Math.round(clip.durationSec * FPS);
  // 单张静态图 + zoompan：放大到大尺寸保证推镜平滑，d=总帧数，z 逐帧累积。
  const filterComplex = [
    `[0:v]scale=6400:-1,` +
      `zoompan=z='min(zoom+0.0004,1.10)':d=${frames}:` +
      `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${OUT_W}x${OUT_H}:fps=${FPS},` +
      `setsar=1,format=yuv420p[bg]`,
    `[bg][1:v]overlay=0:0:format=auto,format=yuv420p[v]`,
  ].join(";");

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loop",
      "1",
      "-i",
      image,
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
      clip.durationSec.toFixed(2),
      "-r",
      `${FPS}`,
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

/** 归一化一段 Seedance 真实画面：裁到指定区间、缩放铺满 16:9、烧录字幕。 */
function buildSeedanceClip(
  clip: SeedanceClip,
  input: string,
  output: string,
  font: string,
) {
  const captionPng = renderCaptionPng(clip.caption, clip.id, font);

  const filterComplex = [
    `[0:v]fps=${FPS},scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,` +
      `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[base]`,
    "[base][1:v]overlay=0:0:format=auto[v]",
  ].join(";");

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      clip.trimStartSec.toFixed(2),
      "-t",
      clip.durationSec.toFixed(2),
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
      clip.durationSec.toFixed(2),
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

/** 给成片叠加纯音乐 BGM：循环铺满、loudnorm、整体淡入淡出。 */
function addBgmOnly(opts: { bgm: string; totalSec: number }) {
  const { bgm, totalSec } = opts;
  const fadeOutStart = Math.max(0, totalSec - 2);
  const gain = readBgmGain(0.85);
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
  console.log("gain =", gain);
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
  execFileSync("python3", ["--version"], { stdio: "ignore" });
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
