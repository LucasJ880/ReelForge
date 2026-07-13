/**
 * 数字人探店广告 · 可复用生成管线（服务）
 * ==================================================================
 *
 * 把「asset 虚拟人 + 店铺实景图 + 中文口播 + 字幕 + 拼接」整条流程封装为一个可
 * 参数化调用的函数，供：
 *   - 外部 GitHub Actions runner（scripts/digital-human-runner.ts，生产出片）
 *   - 本地 CLI（scripts/generate-digital-human-store-ad.ts，演示/调试）
 * 复用。
 *
 * 重要：本模块会调用 ffmpeg / ffprobe / python3（PIL 渲染字幕），因此**只在带
 * ffmpeg 的环境运行**（本地 / GH Actions runner），绝不在 Vercel Serverless 函数里调用。
 *
 * 管线四阶段（全在一个进程内顺序跑）：
 *   1) 分镜      buildDynamicStoreAdStoryboard（gpt-5.5 文案 + 确定性镜头骨架）
 *   2) 生视频    每镜 Seedance 2.0 reference：[asset://虚拟人, 门店图] → 静音片段
 *   3) 口播      buildStoreAdNarration（gpt-5.5）→ 火山 TTS 逐镜合成 mp3
 *   4) 拼接      下载片段 → 归一化 + 烧中文字幕 → 拼接 → 口播为主轨 + 压低 BGM → 成片
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { submitSeedanceJob, getSeedanceStatus } from "@/lib/providers/seedance";
import { synthesizeSpeech } from "@/lib/providers/volc-tts";
import { assertDigitalHumanFeatureEnabled } from "@/lib/features/digital-human";
import {
  buildDynamicStoreAdStoryboard,
  buildStoreAdNarration,
  type DynamicStoreAdBrief,
  type DynamicStoreAdShot,
} from "@/lib/video-generation/digital-human/store-ad-director";

/* ------------------------------------------------------------------ */
/* 类型                                                               */
/* ------------------------------------------------------------------ */

export interface DigitalHumanAdInput {
  /// 任务 id（用于工作目录与日志）
  jobId: string;
  /// 虚拟人资产引用：asset://asset-xxxxx
  avatarAssetUri: string;
  /// 火山音色 ID（speaker）
  voiceType: string;
  /// 店铺实景图公网 URL（≥1）
  storeImageUrls: string[];
  industry: string;
  storeDescription?: string | null;
  sellingPoints?: string[];
  cta?: string | null;
  brandName?: string | null;
  durationSec: number;
  aspectRatio?: string;
}

export interface DigitalHumanAdResult {
  finalVideoPath: string;
  thumbnailPath: string | null;
  storyboard: DynamicStoreAdShot[];
  durationSec: number;
}

export interface PipelineOptions {
  /// 工作目录（默认 tmp/digital-human-jobs/<jobId>）
  workDir?: string;
  /// 中文字体路径（默认从候选里探测）
  captionFont?: string;
  /// 背景音乐路径（默认 scripts/assets/pet-kit-bgm.mp3；设 "none" 关闭）
  bgmPath?: string;
  logger?: (msg: string) => void;
  /// Seedance 轮询超时（分钟），默认 20
  pollMaxMinutes?: number;
}

/* ------------------------------------------------------------------ */
/* 常量                                                               */
/* ------------------------------------------------------------------ */

const FPS = 30;
const ARK_MODEL = process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128";
const CAPTION_RENDERER = resolve(process.cwd(), "scripts/render-caption-png.py");
const DEFAULT_BGM_PATH = resolve(process.cwd(), "scripts/assets/pet-kit-bgm.mp3");

/// 是否烧录中文字幕（默认关闭；需要时设 STORE_AD_BURN_CAPTION=1）
const BURN_CAPTION = isTruthy(process.env.STORE_AD_BURN_CAPTION);

/// Linux runner 用 libx264（videotoolbox 仅 mac）。设 STORE_AD_USE_VIDEOTOOLBOX=true 走硬编。
const VIDEO_ENCODE_ARGS = isTruthy(process.env.STORE_AD_USE_VIDEOTOOLBOX)
  ? ["-c:v", "h264_videotoolbox", "-b:v", "8M", "-pix_fmt", "yuv420p"]
  : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"];

const FONT_CANDIDATES = [
  process.env.STORE_AD_CAPTION_FONT,
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.otf",
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
].filter(Boolean) as string[];

const ASPECT_DIMS: Record<string, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
};

/* ------------------------------------------------------------------ */
/* 主入口                                                             */
/* ------------------------------------------------------------------ */

export async function runDigitalHumanAdPipeline(
  input: DigitalHumanAdInput,
  opts: PipelineOptions = {},
): Promise<DigitalHumanAdResult> {
  assertDigitalHumanFeatureEnabled();
  const log = opts.logger ?? ((m: string) => console.log(m));
  const aspect = input.aspectRatio || "9:16";
  const { w: OUT_W, h: OUT_H } = ASPECT_DIMS[aspect] ?? ASPECT_DIMS["9:16"];

  if (!input.storeImageUrls?.length) {
    throw new Error("至少需要 1 张店铺实景图");
  }
  const avatarUri = input.avatarAssetUri.startsWith("asset://")
    ? input.avatarAssetUri
    : `asset://${input.avatarAssetUri}`;

  const workDir =
    opts.workDir ?? resolve(process.cwd(), "tmp/digital-human-jobs", input.jobId);
  const segDir = resolve(workDir, "segments");
  const voDir = resolve(workDir, "voiceover");
  const normDir = resolve(workDir, "normalized");
  const capDir = resolve(workDir, "captions");
  [workDir, segDir, voDir, normDir, capDir].forEach(ensureDir);
  ensureTools();

  /* --- 阶段 1：分镜 --- */
  log("阶段 1/4 · 分镜（gpt-5.5 文案 + 镜头骨架）");
  const brief: DynamicStoreAdBrief = {
    industry: input.industry,
    storeDescription: input.storeDescription ?? undefined,
    sellingPoints: input.sellingPoints,
    cta: input.cta ?? undefined,
    brandName: input.brandName ?? undefined,
    storeImageCount: input.storeImageUrls.length,
    durationSec: input.durationSec,
  };
  const { shots } = await buildDynamicStoreAdStoryboard(brief);
  log(`  → ${shots.length} 个镜头，总时长 ${shots.reduce((a, s) => a + s.durationSec, 0)}s`);

  /* --- 阶段 2：Seedance reference 生视频 --- */
  log("阶段 2/4 · 提交 Seedance 2.0（asset 虚拟人 + 门店图，开口型说话）");
  const jobIds: Record<string, string> = {};
  for (const shot of shots) {
    const storeUrl = input.storeImageUrls[shot.storeImageIndex] ?? input.storeImageUrls[0];
    const prompt = buildReferencePrompt(shot, input.industry, aspect);
    const { jobId } = await submitSeedanceJob({
      prompt,
      mode: "reference",
      referenceImageUrls: [avatarUri, storeUrl],
      duration: shot.durationSec,
      ratio: aspect as "9:16",
      resolution: "1080p",
      // 开口型：让 Seedance 生成「说话」动作（其自带音轨后续会被中文口播覆盖丢弃）
      generateAudio: true,
      model: ARK_MODEL,
    });
    jobIds[shot.id] = jobId;
    log(`  · ${shot.id} → jobId=${jobId}`);
  }

  log("阶段 2/4 · 轮询 Seedance 出片…");
  const videoUrls = await pollSeedance(jobIds, opts.pollMaxMinutes ?? 20, log);

  /* --- 阶段 3：中文口播 --- */
  log("阶段 3/4 · 中文口播（gpt-5.5 旁白 + 火山 TTS）");
  const { lines } = await buildStoreAdNarration(brief, shots);
  const voPaths: Record<string, string> = {};
  for (const line of lines) {
    const out = resolve(voDir, `vo-${line.id}.mp3`);
    // 复用已有配音：若工作目录里已存在该镜头的 mp3，则直接沿用（无需重跑 TTS）
    if (existsSync(out)) {
      voPaths[line.id] = out;
      log(`  · vo-${line.id}.mp3 复用已有配音`);
      continue;
    }
    const audio = await synthesizeSpeech({
      text: line.text,
      voiceType: input.voiceType,
      encoding: "mp3",
      uid: `aivora-dh-${input.jobId}`,
      speechRate: Number(process.env.VOLC_TTS_SPEECH_RATE || 12),
      contextTexts: [
        "用轻松自然、像在跟好朋友分享的探店语气说，热情但不浮夸，有亲和力。",
      ],
    });
    writeFileSync(out, audio);
    voPaths[line.id] = out;
    log(`  · vo-${line.id}.mp3 「${line.text}」`);
  }

  /* --- 阶段 4：拼接成片 --- */
  log("阶段 4/4 · 归一化 + 烧字幕 + 拼接 + 口播主轨 + 压低 BGM");
  const font = resolveFont(log);
  const normalizedPaths: string[] = [];
  for (const shot of shots) {
    const src = videoUrls[shot.id];
    if (!src) throw new Error(`${shot.id} 缺少 Seedance 出片 URL`);
    const local = await downloadTo(src, resolve(segDir, `seg-${shot.id}.mp4`));
    const out = resolve(normDir, `clip-${shot.id}.mp4`);
    buildClip({
      input: local,
      output: out,
      durationSec: shot.durationSec,
      caption: shot.caption,
      font,
      outW: OUT_W,
      outH: OUT_H,
      capDir,
    });
    normalizedPaths.push(out);
  }

  const concatList = resolve(workDir, "concat-list.txt");
  const concatOut = resolve(workDir, "concat-no-bgm.mp4");
  writeFileSync(
    concatList,
    normalizedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
    "utf8",
  );
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", concatOut],
    { stdio: "inherit" },
  );

  const totalSec = probeDurationSec(concatOut);
  const finalOut = resolve(workDir, "final.mp4");
  const bgm = resolveBgm(opts.bgmPath);
  const voiceParts = collectVoiceParts(shots, voPaths);
  mixAudio({ concatOut, finalOut, voiceParts, bgm, totalSec });

  const thumbOut = resolve(workDir, "thumb.jpg");
  const thumbnailPath = makeThumbnail(finalOut, thumbOut) ? thumbOut : null;

  log(`成片完成 ≈ ${totalSec.toFixed(1)}s → ${finalOut}`);
  return {
    finalVideoPath: finalOut,
    thumbnailPath,
    storyboard: shots,
    durationSec: totalSec,
  };
}

/* ------------------------------------------------------------------ */
/* 分镜 → reference prompt                                            */
/* ------------------------------------------------------------------ */

function buildReferencePrompt(
  shot: DynamicStoreAdShot,
  industry: string,
  aspect: string,
): string {
  return [
    `图片1中的年轻女生作为出镜探店博主，自然地置身于图片2这家${industry}里。`,
    `画面里只有她一个人，真实探店 vlog 质感，自然光，竖屏 ${aspect}，不要出现其他人、文字或水印。`,
    `场景：${shot.scene}。`,
    `动作：${shot.action}。`,
    "Gentle natural human motion, subtle slow camera move, premium and stable.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Seedance 轮询                                                      */
/* ------------------------------------------------------------------ */

async function pollSeedance(
  jobIds: Record<string, string>,
  maxMinutes: number,
  log: (m: string) => void,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const deadline = Date.now() + maxMinutes * 60_000;
  const pending = () => Object.keys(jobIds).filter((id) => !result[id]);

  while (pending().length > 0 && Date.now() < deadline) {
    for (const shotId of pending()) {
      const r = await getSeedanceStatus(jobIds[shotId]);
      if (r.status === "completed" && r.videoUrl) {
        result[shotId] = r.videoUrl;
        log(`  ✔ ${shotId} 完成`);
      } else if (r.status === "failed") {
        throw new Error(`${shotId} Seedance 生成失败：${r.errorMessage ?? "unknown"}`);
      }
    }
    if (pending().length > 0) await sleep(15_000);
  }
  const missing = pending();
  if (missing.length > 0) {
    throw new Error(`Seedance 在 ${maxMinutes} 分钟内未全部完成：${missing.join(", ")}`);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* ffmpeg 帮助                                                        */
/* ------------------------------------------------------------------ */

function buildClip(opts: {
  input: string;
  output: string;
  durationSec: number;
  caption: string;
  font: string;
  outW: number;
  outH: number;
  capDir: string;
}) {
  const { input, output, durationSec, caption, font, outW, outH, capDir } = opts;
  const captionPng = renderCaptionPng(caption, basenameNoExt(output), font, outW, outH, capDir);

  const base =
    `[0:v]fps=${FPS},scale=${outW}:${outH}:force_original_aspect_ratio=increase,` +
    `crop=${outW}:${outH},setsar=1,format=yuv420p`;
  const filter = captionPng
    ? `${base}[bg];[bg][1:v]overlay=0:0:format=auto[v]`
    : `${base}[v]`;

  const inputArgs = ["-t", durationSec.toFixed(2), "-i", input];
  if (captionPng) inputArgs.push("-loop", "1", "-i", captionPng);
  inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  const audioMap = captionPng ? "2:a:0" : "1:a:0";

  execFileSync(
    "ffmpeg",
    [
      "-y",
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      audioMap,
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

function renderCaptionPng(
  caption: string,
  id: string,
  font: string,
  outW: number,
  outH: number,
  capDir: string,
): string | null {
  if (!BURN_CAPTION || !caption.trim()) return null;
  const captionFile = resolve(capDir, `caption-${id}.txt`);
  const captionPng = resolve(capDir, `caption-${id}.png`);
  writeFileSync(captionFile, caption, "utf8");
  execFileSync(
    "python3",
    [CAPTION_RENDERER, font, captionFile, captionPng, `${outW}`, `${outH}`, "0"],
    { stdio: "inherit" },
  );
  return captionPng;
}

function collectVoiceParts(
  shots: DynamicStoreAdShot[],
  voPaths: Record<string, string>,
): Array<{ path: string; startSec: number }> {
  const parts: Array<{ path: string; startSec: number }> = [];
  let cursor = 0;
  for (const shot of shots) {
    const p = voPaths[shot.id];
    if (p && existsSync(p)) parts.push({ path: p, startSec: cursor });
    cursor += shot.durationSec;
  }
  return parts;
}

function mixAudio(opts: {
  concatOut: string;
  finalOut: string;
  voiceParts: Array<{ path: string; startSec: number }>;
  bgm: string | null;
  totalSec: number;
}) {
  const { concatOut, finalOut, voiceParts, bgm, totalSec } = opts;

  /// 无口播：仅 BGM 或直接拷贝
  if (voiceParts.length === 0) {
    if (!bgm) {
      execFileSync("ffmpeg", ["-y", "-i", concatOut, "-c", "copy", finalOut], {
        stdio: "inherit",
      });
      return;
    }
  }

  const voGain = Number(process.env.STORE_AD_VO_GAIN) || 1.0;
  const bgmGain = Number(process.env.STORE_AD_BGM_DUCK_GAIN) || 0.15;
  const fadeOutStart = Math.max(0, totalSec - 2);

  const args: string[] = ["-y", "-i", concatOut];
  voiceParts.forEach((v) => args.push("-i", v.path));
  const bgmIdx = bgm ? voiceParts.length + 1 : -1;
  if (bgm) args.push("-stream_loop", "-1", "-i", bgm);

  const filters: string[] = [];
  voiceParts.forEach((v, k) => {
    const ms = Math.round(v.startSec * 1000);
    filters.push(
      `[${k + 1}:a]adelay=${ms}|${ms},aformat=sample_rates=44100:channel_layouts=stereo[vo${k}]`,
    );
  });
  const voLabels = voiceParts.map((_, k) => `[vo${k}]`).join("");
  if (voiceParts.length >= 2) {
    filters.push(`${voLabels}amix=inputs=${voiceParts.length}:normalize=0:dropout_transition=0[vomix]`);
  } else {
    filters.push(`${voLabels}anull[vomix]`);
  }
  filters.push(`[vomix]volume=${voGain},apad,atrim=0:${totalSec.toFixed(2)}[vospk]`);

  let mixLabel = "[vospk]";
  if (bgm) {
    filters.push(
      `[${bgmIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,` +
        `atrim=0:${totalSec.toFixed(2)},volume=${bgmGain},` +
        `afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2[bgm]`,
    );
    filters.push(`[vospk][bgm]amix=inputs=2:normalize=0:duration=first[mix]`);
    mixLabel = "[mix]";
  }
  filters.push(`${mixLabel}loudnorm=I=-16:TP=-1.5:LRA=11[a]`);

  execFileSync(
    "ffmpeg",
    [
      ...args,
      "-filter_complex",
      filters.join(";"),
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
      finalOut,
    ],
    { stdio: "inherit" },
  );
}

function makeThumbnail(videoPath: string, out: string): boolean {
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-ss", "1", "-i", videoPath, "-frames:v", "1", "-q:v", "3", out],
      { stdio: "ignore" },
    );
    return existsSync(out);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

async function downloadTo(url: string, dest: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    const local = url.startsWith("file://") ? url.slice(7) : url;
    return isAbsolute(local) ? local : resolve(process.cwd(), local);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${res.statusText}: ${url.slice(0, 80)}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function probeDurationSec(input: string): number {
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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function resolveFont(log: (m: string) => void): string {
  const found = FONT_CANDIDATES.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      `找不到中文字体（请设 STORE_AD_CAPTION_FONT 或安装 fonts-noto-cjk）。已尝试：${FONT_CANDIDATES.join(", ")}`,
    );
  }
  log(`  captionFont=${found}`);
  return found;
}

function resolveBgm(bgmPath?: string): string | null {
  const raw = bgmPath ?? process.env.STORE_AD_BGM;
  if (raw === "none") return null;
  if (raw) {
    const abs = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
    return existsSync(abs) ? abs : null;
  }
  return existsSync(DEFAULT_BGM_PATH) ? DEFAULT_BGM_PATH : null;
}

function ensureTools() {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
  execFileSync("python3", ["--version"], { stdio: "ignore" });
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function basenameNoExt(p: string): string {
  const b = p.split("/").pop() ?? p;
  return b.replace(/\.[^.]+$/, "");
}

function isTruthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
