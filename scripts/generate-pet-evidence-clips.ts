/**
 * 生成 Aivora「真实产品输出」证据短片（竖版 9:16），用于 demo 页面证明
 * 产品真的能自动产出可分享的可爱视频 / 品牌可用的产品使用片段。
 *
 * 一个脚本搞定：Seedance 提交 → 内部轮询 → 下载 → ffmpeg 归一化到 720x1280
 *   → 烧录竖版中文字幕（raw 片不烧）→ 叠加纯音乐 BGM（raw 片不叠）→ 落到
 *   public/generated/pet-evidence-{id}.mp4。
 *
 * 幂等：进度写 tmp/pet-evidence/submission.json，重跑会复用已提交 jobId 与已下载源。
 *
 * 用法：
 *   npm run demo:gen:evidence            # 全量
 *   PET_EVIDENCE_ONLY=highlight,mat npm run demo:gen:evidence   # 仅指定
 *
 * 需要 BYTEPLUS_ARK_API_KEY（真实 Seedance）。
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSeedanceStatus, submitSeedanceJob } from "../src/lib/providers/seedance";

loadEnvConfig(process.cwd());

const WORK_DIR = resolve(process.cwd(), "tmp/pet-evidence");
const SOURCE_DIR = resolve(WORK_DIR, "source");
const CAPTION_DIR = resolve(WORK_DIR, "captions");
const SUBMISSION_PATH = resolve(WORK_DIR, "submission.json");
const PUBLIC_OUTPUT_DIR = resolve(process.cwd(), "public/generated");
const CAPTION_RENDERER = resolve(process.cwd(), "scripts/render-caption-png.py");
const DEFAULT_BGM_PATH = resolve(process.cwd(), "scripts/assets/pet-kit-bgm.mp3");

const OUT_W = 720;
const OUT_H = 1280;
const FPS = 30;

const VIDEO_ENCODE_ARGS = isTruthy(process.env.PET_USE_X264)
  ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
  : ["-c:v", "h264_videotoolbox", "-b:v", "5M", "-pix_fmt", "yuv420p"];

const FONT_CANDIDATES = [
  process.env.PET_CAPTION_FONT,
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
].filter(Boolean) as string[];

const SHARED_STYLE = [
  "9:16 vertical, social-media short video look, cinematic but natural.",
  "Warm, cozy, premium home interior, soft natural light, shallow depth of field.",
  "An adorable real-looking cat or small dog with natural, candid, lovable behavior.",
  "Absolutely NO text, NO captions, NO subtitles, NO watermark, NO logos, NO UI overlays.",
  "No close-up human faces; if a person appears, show only hands or silhouette.",
].join(" ");

type EvidenceClip = {
  id: string;
  duration: number;
  /** 烧录的竖版中文字幕；null = 不烧（raw 原始素材感） */
  caption: string | null;
  /** 是否叠加纯音乐 BGM；raw 片为 false 保持「未剪辑」质感 */
  withMusic: boolean;
  prompt: string;
};

const CLIPS: EvidenceClip[] = [
  {
    id: "highlight",
    duration: 8,
    // 不烧字幕：clip 在 PhoneVideoMockup 里播放，字幕由 UI overlay 提供（支持 emoji、
    // 样式统一、不会与烧录字幕重叠），standalone 也保持干净的「真实成片」观感。
    caption: null,
    withMusic: true,
    prompt:
      "A cozy warm-lit home. A fluffy adorable cat has a series of cute candid moments: eating happily from a bowl, an endearing head tilt toward camera, rolling playfully on a soft plush mat, batting at a feather toy. Heartwarming highlight-reel feeling, smooth gentle camera, shareable and lovable.",
  },
  {
    id: "headtilt",
    duration: 8,
    caption: null,
    withMusic: true,
    prompt:
      "Close-up of an extremely cute fluffy cat doing adorable head tilts toward the camera, big curious eyes, soft warm window light, dreamy shallow depth of field. Irresistibly cute, perfect viral close-up moment.",
  },
  {
    id: "mat",
    duration: 9,
    caption: null,
    withMusic: true,
    prompt:
      "A small dog walks over to a premium soft beige plush pet mat on a warm wooden floor, sniffs it, then happily settles down and relaxes on it, looking cozy and content. Cozy lifestyle product-in-use feeling, warm cream tones, natural and genuine.",
  },
  {
    id: "raw",
    duration: 10,
    caption: null,
    withMusic: false,
    prompt:
      "An ordinary unedited home phone clip: a cat lounging on a windowsill on a quiet afternoon, mostly still, occasionally blinking and shifting, plain everyday footage, slightly mundane, natural ambient look. The kind of long raw clip a pet owner would casually record.",
  },
];

const POLL_INTERVAL_MS = 15000;
const POLL_TIMEOUT_MS = 18 * 60 * 1000;

type Record = {
  clips: Array<{
    id: string;
    jobId?: string;
    videoUrl?: string;
    status?: string;
  }>;
};

async function main() {
  if (!process.env.BYTEPLUS_ARK_API_KEY) throw new Error("缺少 BYTEPLUS_ARK_API_KEY，无法生成证据短片。");
  ensureTools();
  [WORK_DIR, SOURCE_DIR, CAPTION_DIR, PUBLIC_OUTPUT_DIR].forEach(ensureDir);

  const only = (process.env.PET_EVIDENCE_ONLY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const selected = only.length > 0 ? CLIPS.filter((c) => only.includes(c.id)) : CLIPS;

  const record = readRecord();
  const model = process.env.ARK_VIDEO_MODEL || "dreamina-seedance-2-0-260128";
  const font = resolveFont();

  // 1) 提交（复用已存在 jobId）
  banner("提交 Seedance 竖版证据短片");
  for (const clip of selected) {
    const entry = upsert(record, clip.id);
    if (entry.jobId) {
      console.log(`clip ${clip.id} 已有 jobId=${entry.jobId}，跳过提交`);
      continue;
    }
    const { jobId } = await submitSeedanceJob({
      prompt: `${clip.prompt}\n\nStyle:\n${SHARED_STYLE}\n\nOutput: 9:16 vertical, ~${clip.duration}s.`,
      duration: clip.duration,
      ratio: "9:16",
      model,
      generateAudio: false,
    });
    entry.jobId = jobId;
    entry.status = "submitted";
    writeRecord(record);
    console.log(`clip ${clip.id} 提交成功 jobId=${jobId}`);
  }

  // 2) 轮询直到全部完成
  banner("轮询生成状态");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const pending = new Set(
    selected.filter((c) => !upsert(record, c.id).videoUrl).map((c) => c.id),
  );
  while (pending.size > 0) {
    if (Date.now() > deadline) {
      throw new Error(`轮询超时，仍未完成：${[...pending].join(", ")}`);
    }
    for (const id of [...pending]) {
      const entry = upsert(record, id);
      if (!entry.jobId) continue;
      const status = await getSeedanceStatus(entry.jobId);
      entry.status = status.status;
      if (status.status === "completed" && status.videoUrl) {
        entry.videoUrl = status.videoUrl;
        writeRecord(record);
        pending.delete(id);
        console.log(`clip ${id} 完成 ✓`);
      } else if (status.status === "failed") {
        throw new Error(`clip ${id} 生成失败：${status.errorMessage ?? "unknown"}`);
      } else {
        console.log(`clip ${id} ${status.status} ${status.progress ?? 0}%`);
      }
    }
    if (pending.size > 0) await sleep(POLL_INTERVAL_MS);
  }

  // 3) 下载 + 归一化 + 字幕 + BGM
  banner("下载并拼接竖版成片");
  for (const clip of selected) {
    const entry = upsert(record, clip.id);
    if (!entry.videoUrl) throw new Error(`clip ${clip.id} 缺少 videoUrl`);
    const src = await download(entry.videoUrl, clip.id);
    const out = resolve(PUBLIC_OUTPUT_DIR, `pet-evidence-${clip.id}.mp4`);
    buildVerticalClip(clip, src, out, font);
    console.log(`clip ${clip.id} -> ${out}`);
  }

  banner("完成");
  for (const clip of selected) {
    console.log(`/generated/pet-evidence-${clip.id}.mp4`);
  }
  console.log("把这些 URL 填进 src/lib/demo/pet-content-kit-demo-data.ts 的对应 videoUrl。");
}

function buildVerticalClip(
  clip: EvidenceClip,
  input: string,
  output: string,
  font: string,
) {
  const baseFilter =
    `[0:v]fps=${FPS},scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
    `crop=${OUT_W}:${OUT_H},setsar=1,format=yuv420p`;

  // 视频帧链（可选叠字幕）
  const inputs: string[] = ["-i", input];
  let filterComplex: string;
  let mapVideo: string;

  if (clip.caption) {
    const captionPng = renderCaptionPng(clip.caption, clip.id, font);
    inputs.push("-loop", "1", "-i", captionPng);
    filterComplex =
      `${baseFilter}[base];[base][1:v]overlay=0:0:format=auto,format=yuv420p[v]`;
    mapVideo = "[v]";
  } else {
    filterComplex = `${baseFilter}[v]`;
    mapVideo = "[v]";
  }

  // 音频：withMusic → 叠 BGM；否则静音
  const bgm = clip.withMusic ? resolveBgm() : null;
  const args = ["-y", ...inputs];
  if (bgm) {
    const fadeOutStart = Math.max(0, clip.duration - 1.5);
    const audioFilter = [
      "aformat=sample_rates=44100:channel_layouts=stereo",
      `atrim=0:${clip.duration.toFixed(2)}`,
      "loudnorm=I=-18:TP=-1.5:LRA=11",
      "volume=0.9",
      "afade=t=in:st=0:d=0.8",
      `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=1.5`,
    ].join(",");
    args.push(
      "-stream_loop",
      "-1",
      "-i",
      bgm,
      "-filter_complex",
      `${filterComplex};[${clip.caption ? 2 : 1}:a]${audioFilter}[a]`,
      "-map",
      mapVideo,
      "-map",
      "[a]",
    );
  } else {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex",
      filterComplex,
      "-map",
      mapVideo,
      "-map",
      `${clip.caption ? 2 : 1}:a:0`,
    );
  }

  args.push(
    "-t",
    clip.duration.toFixed(2),
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
  );

  execFileSync("ffmpeg", args, { stdio: "inherit" });
}

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

async function download(url: string, id: string) {
  const out = resolve(SOURCE_DIR, `${id}-source.mp4`);
  if (existsSync(out) && statSync(out).size > 0 && !isTruthy(process.env.PET_EVIDENCE_REDOWNLOAD)) {
    return out;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载 ${id} 失败：${res.status} ${res.statusText}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

function readRecord(): Record {
  if (existsSync(SUBMISSION_PATH)) {
    return JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as Record;
  }
  return { clips: [] };
}

function upsert(record: Record, id: string) {
  let entry = record.clips.find((c) => c.id === id);
  if (!entry) {
    entry = { id };
    record.clips.push(entry);
  }
  return entry;
}

function writeRecord(record: Record) {
  writeFileSync(SUBMISSION_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function resolveBgm() {
  if (existsSync(DEFAULT_BGM_PATH)) return DEFAULT_BGM_PATH;
  return null;
}

function resolveFont() {
  const found = FONT_CANDIDATES.find((c) => existsSync(c));
  if (!found) throw new Error("找不到可用的中文字体（设置 PET_CAPTION_FONT）。");
  return found;
}

function ensureTools() {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("python3", ["--version"], { stdio: "ignore" });
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function isTruthy(value?: string) {
  const v = value?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

main().catch((err) => {
  console.error("\n证据短片生成失败：");
  console.error((err as Error).message);
  process.exit(1);
});
