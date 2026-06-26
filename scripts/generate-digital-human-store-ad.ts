/**
 * 数字人探店广告 · 端到端交付脚本
 * ==================================================================
 *
 * 用「一张模特图 + 真实门店照片」生成一条 ~30s 竖版（9:16）宠物店探店广告：
 *
 *   1) keyframes  gpt-5.5 编排探店分镜 → gpt-image-1 images.edit 把模特身份一致地
 *                 合成进每个真实门店场景，产出关键帧（落 Vercel Blob 公网 URL）。
 *   2) submit     每个 model_store 镜头用 Seedance 2.0（doubao-seedance-2-0）做 i2v：
 *                 关键帧作 first_frame，generate_audio=false（成片统一铺 BGM + 烧字幕）。
 *   3) wait       轮询 Seedance 至全部完成。
 *   4) stitch     下载片段 + 复用现有橘猫产品空镜 → 归一化 1080x1920 → 烧中文字幕
 *                 → 拼接 → 叠加 BGM → 追加 Aivora 品牌尾卡 → 成片。
 *
 * 全程真实模型（需 ARK_API_KEY / OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN）。
 *
 * 用法：
 *   tsx scripts/generate-digital-human-store-ad.ts                  # 跑完整流程
 *   tsx scripts/generate-digital-human-store-ad.ts --phase=keyframes
 *   tsx scripts/generate-digital-human-store-ad.ts --phase=submit
 *   tsx scripts/generate-digital-human-store-ad.ts --phase=wait
 *   tsx scripts/generate-digital-human-store-ad.ts --phase=stitch
 *   tsx scripts/generate-digital-human-store-ad.ts --only-shot=03-shelf   # 仅重做某镜头(keyframe+submit)
 *
 * 中文字体默认 /System/Library/Fonts/PingFang.ttc，可用 STORE_AD_CAPTION_FONT 覆盖。
 * 成片：public/generated/aivora-digital-human-pet-store-30s-9x16.mp4
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

loadEnvConfig(process.cwd());

import { submitSeedanceJob, getSeedanceStatus } from "../src/lib/providers/seedance";
import { getStorageProvider } from "../src/lib/storage";
import type {
  StoreAdShot,
  StoreRefKey,
} from "../src/lib/video-generation/digital-human/store-ad-director";

/// 注意：store-ad-director 会加载 openai.ts，而后者在模块加载时就实例化 OpenAI 单例
/// （读 OPENAI_API_KEY）。loadEnvConfig 在所有静态 import 之后才跑，所以必须把
/// director 改为「env 加载后再动态导入」，否则 gpt-5.5 会拿到占位 key 报 401。
type DirectorModule = typeof import("../src/lib/video-generation/digital-human/store-ad-director");
let _director: DirectorModule | null = null;
async function director(): Promise<DirectorModule> {
  if (!_director) {
    _director = await import(
      "../src/lib/video-generation/digital-human/store-ad-director"
    );
  }
  return _director;
}

/* ------------------------------------------------------------------ */
/* 路径与常量                                                          */
/* ------------------------------------------------------------------ */

const WORK_DIR = resolve(process.cwd(), "tmp/digital-human-store-ad");
const SEGMENT_DIR = resolve(WORK_DIR, "segments");
const NORMALIZED_DIR = resolve(WORK_DIR, "normalized");
const CAPTION_DIR = resolve(WORK_DIR, "captions");
const STORYBOARD_PATH = resolve(WORK_DIR, "storyboard.json");
const SUBMISSION_PATH = resolve(WORK_DIR, "submission.json");
const STORE_REFS_PATH = resolve(WORK_DIR, "store-refs.json");
const VOICEOVER_DIR = resolve(WORK_DIR, "voiceover");
const CONCAT_LIST_PATH = resolve(WORK_DIR, "concat-list.txt");
const CONCAT_OUTPUT_PATH = resolve(WORK_DIR, "concat-no-bgm.mp4");

const STORE_ASSET_DIR = resolve(process.cwd(), "public/demo/pet-store");
const PUBLIC_OUTPUT_DIR = resolve(process.cwd(), "public/generated");
const FINAL_OUTPUT_PATH = resolve(
  PUBLIC_OUTPUT_DIR,
  "aivora-digital-human-pet-store-30s-9x16.mp4",
);
const CAPTION_RENDERER = resolve(process.cwd(), "scripts/render-caption-png.py");
const ENDCARD_IMAGE = resolve(process.cwd(), "public/demo/pet/aivora-logo-endcard.png");
const DEFAULT_BGM_PATH = resolve(process.cwd(), "scripts/assets/pet-kit-bgm.mp3");
/// 产品空镜：复用现有 AI 生成的橘猫干饭片段
const CAT_CUTAWAY_PATH = resolve(
  process.cwd(),
  "public/generated/pet-evidence-highlight.mp4",
);

const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const ENDCARD_DURATION_SEC = 3;
const ARK_MODEL = process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128";

/// 数字人模特：火山方舟「虚拟人像库」预置虚拟人资产（asset://...）。
/// 用 asset 引用规避真人过滤；可用 STORE_AD_MODEL_ASSET 覆盖（填 asset-xxx 或 asset://asset-xxx）。
const MODEL_ASSET_RAW =
  process.env.STORE_AD_MODEL_ASSET || "asset-20260401123823-6d4x2";
const MODEL_ASSET_URI = MODEL_ASSET_RAW.startsWith("asset://")
  ? MODEL_ASSET_RAW
  : `asset://${MODEL_ASSET_RAW}`;

const VIDEO_ENCODE_ARGS = isTruthy(process.env.STORE_AD_USE_X264)
  ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
  : ["-c:v", "h264_videotoolbox", "-b:v", "8M", "-pix_fmt", "yuv420p"];

const FONT_CANDIDATES = [
  process.env.STORE_AD_CAPTION_FONT,
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/System/Library/Fonts/Supplemental/Songti.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
].filter(Boolean) as string[];

const BRIEF = {
  industry: "宠物店 / 猫咪主题店",
  storeDescription:
    "一家浅蓝白粉色系、很治愈的猫咪主题宠物店：透明玻璃猫舍寄养区 + 木质猫爬架、白色木框收银台 + 招财猫、可爱产品货架、靠窗休息区与落地玻璃门。",
  modelDescription: "一位长黑发、气质清新的年轻亚洲女生，作为出镜探店博主/数字人模特。",
  brandName: "Aivora",
};

const STORE_REF_FILE: Record<StoreRefKey, string> = {
  "store-1": resolve(STORE_ASSET_DIR, "store-1.png"),
  "store-2": resolve(STORE_ASSET_DIR, "store-2.png"),
  "store-3": resolve(STORE_ASSET_DIR, "store-3.png"),
};
const MODEL_FILE = resolve(STORE_ASSET_DIR, "model.png");

/* ------------------------------------------------------------------ */
/* 持久化类型                                                          */
/* ------------------------------------------------------------------ */

type StoryboardFile = {
  generatedAt: string;
  captionsFromLLM: boolean;
  shots: Array<StoreAdShot & { keyframeUrl?: string }>;
};

/// 门店参考图的公网 URL（Seedance reference 模式作场景参考）。
type StoreRefsFile = {
  updatedAt: string;
  urls: Partial<Record<StoreRefKey, string>>;
};

type SubmissionFile = {
  model: string;
  ratio: "9:16";
  resolution: string;
  updatedAt: string;
  shots: Array<{
    id: string;
    durationSec: number;
    keyframeUrl?: string;
    externalJobId?: string;
    seedanceStatus?: "pending" | "processing" | "completed" | "failed";
    videoUrl?: string;
    errorMessage?: string;
  }>;
};

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  ensureDir(WORK_DIR);
  const phase = readFlag("--phase") ?? "all";
  const onlyShot = readFlag("--only-shot");

  if (phase === "all" || phase === "keyframes") await runKeyframes(onlyShot);
  if (phase === "all" || phase === "submit") await runSubmit(onlyShot);
  if (phase === "all" || phase === "wait") await runWait();
  if (phase === "all" || phase === "stitch") await runStitch();
}

/* ---------------------------- 阶段 1：分镜 + 门店参考图 ---------------------- */

async function runKeyframes(_onlyShot?: string) {
  banner("阶段 1 / 分镜：gpt-5.5 探店文案 + 上传门店参考图到 Blob");
  (Object.keys(STORE_REF_FILE) as StoreRefKey[]).forEach((k) =>
    assertFile(STORE_REF_FILE[k], `门店图 ${k}`),
  );

  const { buildStoreAdStoryboard } = await director();
  const existing = readJsonIfExists<StoryboardFile>(STORYBOARD_PATH);
  const { shots, captionsFromLLM } = await buildStoreAdStoryboard(BRIEF);
  /// 已有 storyboard 时复用已确认的中文文案，避免重跑覆盖已验收文案。
  const merged: StoryboardFile["shots"] = shots.map((s) => {
    const ex = existing?.shots.find((e) => e.id === s.id);
    return { ...s, caption: ex?.caption ?? s.caption };
  });
  const finalCaptionsFromLLM = existing ? existing.captionsFromLLM : captionsFromLLM;

  /// 数字人路线：模特用 asset:// 虚拟人，门店图作为 Seedance reference 的场景参考，
  /// 因此这里只需把门店原图上传成公网 URL（不再做 gpt-image 合成）。
  await ensureStoreRefs();

  const file: StoryboardFile = {
    generatedAt: new Date().toISOString(),
    captionsFromLLM: finalCaptionsFromLLM,
    shots: merged,
  };
  writeFileSync(STORYBOARD_PATH, JSON.stringify(file, null, 2), "utf8");
  console.log(`storyboard.json 已写入（captionsFromLLM=${captionsFromLLM}）`);
}

/* ---------------------------- 阶段 2：提交 ------------------------ */

async function runSubmit(onlyShot?: string) {
  banner("阶段 2 / 提交：Seedance 2.0 多模态参考（asset 虚拟人 + 门店图，静音）");
  const { MOTION_STYLE } = await director();
  const onlyShots = parseOnlyShots(onlyShot);
  const storyboard = readJson<StoryboardFile>(STORYBOARD_PATH, "请先跑 --phase=keyframes");
  const storeRefs = await ensureStoreRefs();
  console.log(`模特资产：${MODEL_ASSET_URI}`);

  const prev = readJsonIfExists<SubmissionFile>(SUBMISSION_PATH);
  const submission: SubmissionFile = {
    model: ARK_MODEL,
    ratio: "9:16",
    resolution: "1080p",
    updatedAt: new Date().toISOString(),
    shots: storyboard.shots.map((s) => {
      const old = prev?.shots.find((p) => p.id === s.id);
      return {
        id: s.id,
        durationSec: s.durationSec,
        keyframeUrl: s.keyframeUrl,
        externalJobId: old?.externalJobId,
        seedanceStatus: old?.seedanceStatus,
        videoUrl: old?.videoUrl,
        errorMessage: old?.errorMessage,
      };
    }),
  };

  for (const shot of storyboard.shots) {
    if (shot.sceneType !== "model_store") continue; // 空镜不走 Seedance
    if (onlyShots && !onlyShots.includes(shot.id)) continue;
    const slot = submission.shots.find((p) => p.id === shot.id)!;
    if (slot.videoUrl && !onlyShots) {
      console.log(`· ${shot.id} 已完成，跳过`);
      continue;
    }
    if (!shot.storeRef) {
      throw new Error(`${shot.id} 缺少 storeRef`);
    }
    const storeUrl = storeRefs.urls[shot.storeRef];
    if (!storeUrl) {
      throw new Error(`${shot.id} 缺少门店参考图 URL（${shot.storeRef}），请先跑 keyframes`);
    }
    const prompt = buildReferencePrompt(shot, MOTION_STYLE);
    console.log(`· ${shot.id} 提交 Seedance reference（${shot.durationSec}s，store=${shot.storeRef}）...`);
    const { jobId } = await submitSeedanceJob({
      prompt,
      mode: "reference",
      referenceImageUrls: [MODEL_ASSET_URI, storeUrl],
      duration: shot.durationSec,
      ratio: "9:16",
      resolution: "1080p",
      generateAudio: false,
      model: ARK_MODEL,
    });
    slot.externalJobId = jobId;
    slot.seedanceStatus = "pending";
    slot.videoUrl = undefined;
    slot.errorMessage = undefined;
    console.log(`  → jobId=${jobId}`);
    persistSubmission(submission);
  }
  persistSubmission(submission);
}

/* ---------------------------- 阶段 3：轮询 ------------------------ */

async function runWait() {
  banner("阶段 3 / 轮询：等待 Seedance 全部完成");
  const submission = readJson<SubmissionFile>(SUBMISSION_PATH, "请先跑 --phase=submit");
  const pollIntervalMs = 15_000;
  const maxMinutes = 20;
  const deadline = Date.now() + maxMinutes * 60_000;

  const pending = () =>
    submission.shots.filter(
      (s) => s.externalJobId && s.seedanceStatus !== "completed" && s.seedanceStatus !== "failed",
    );

  while (pending().length > 0 && Date.now() < deadline) {
    for (const slot of pending()) {
      const r = await getSeedanceStatus(slot.externalJobId!);
      slot.seedanceStatus = r.status;
      if (r.status === "completed") {
        slot.videoUrl = r.videoUrl;
        console.log(`✔ ${slot.id} 完成`);
      } else if (r.status === "failed") {
        slot.errorMessage = r.errorMessage;
        console.error(`x ${slot.id} 失败：${r.errorMessage}`);
      } else {
        console.log(`… ${slot.id} ${r.status}${r.progress ? ` ${r.progress}%` : ""}`);
      }
    }
    persistSubmission(submission);
    if (pending().length > 0) await sleep(pollIntervalMs);
  }

  const failed = submission.shots.filter((s) => s.seedanceStatus === "failed");
  const incomplete = submission.shots.filter(
    (s) => s.externalJobId && !s.videoUrl && s.seedanceStatus !== "failed",
  );
  if (failed.length) {
    console.error(`有 ${failed.length} 个镜头失败：`, failed.map((f) => f.id).join(", "));
  }
  if (incomplete.length) {
    throw new Error(
      `${incomplete.length} 个镜头在 ${maxMinutes} 分钟内未完成：${incomplete.map((s) => s.id).join(", ")}`,
    );
  }
  if (failed.length) {
    throw new Error("有镜头失败，修复后用 --only-shot 重做对应镜头");
  }
  console.log("全部镜头完成。");
}

/* ---------------------------- 阶段 4：拼接 ------------------------ */

async function runStitch() {
  banner("阶段 4 / 拼接：归一化 + 烧字幕 + 拼接 + BGM + 品牌尾卡");
  ensureTools();
  ensureDir(SEGMENT_DIR);
  ensureDir(NORMALIZED_DIR);
  ensureDir(CAPTION_DIR);
  ensureDir(PUBLIC_OUTPUT_DIR);

  const storyboard = readJson<StoryboardFile>(STORYBOARD_PATH, "请先跑 keyframes");
  const submission = readJson<SubmissionFile>(SUBMISSION_PATH, "请先跑 submit/wait");
  const font = resolveFont();

  const normalizedPaths: string[] = [];
  for (const shot of storyboard.shots) {
    const out = resolve(NORMALIZED_DIR, `clip-${shot.id}.mp4`);
    if (shot.sceneType === "product_cutaway") {
      assertFile(CAT_CUTAWAY_PATH, "橘猫产品空镜");
      buildClip({
        input: CAT_CUTAWAY_PATH,
        output: out,
        durationSec: shot.durationSec,
        caption: shot.caption,
        font,
        trimStartSec: 1.0,
      });
    } else {
      const slot = submission.shots.find((s) => s.id === shot.id);
      const src = slot?.videoUrl;
      if (!src) throw new Error(`${shot.id} 缺少 Seedance videoUrl（先 submit/wait）`);
      const local = await prepareInput(src, shot.id);
      buildClip({
        input: local,
        output: out,
        durationSec: shot.durationSec,
        caption: shot.caption,
        font,
        trimStartSec: 0,
      });
    }
    console.log(`clip ${shot.id} → ${out}`);
    normalizedPaths.push(out);
  }

  // 品牌尾卡（STORE_AD_ENDCARD=none 可跳过；当前 logo 尾卡未适配 9:16，默认仍保留）
  const useEndcard =
    process.env.STORE_AD_ENDCARD !== "none" && existsSync(ENDCARD_IMAGE);
  if (useEndcard) {
    const endOut = resolve(NORMALIZED_DIR, "clip-99-endcard.mp4");
    buildEndcardClip(ENDCARD_IMAGE, endOut);
    normalizedPaths.push(endOut);
    console.log(`clip 99-endcard → ${endOut}`);
  } else {
    console.log("· 跳过品牌尾卡（STORE_AD_ENDCARD=none）");
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
  const voiceParts = collectVoiceParts(storyboard);

  if (voiceParts.length > 0) {
    banner("混音：中文口播旁白（主轨）+ 压低 BGM");
    addVoiceoverAndBgm({ voiceParts, bgm, totalSec });
    console.log(`voiceover = ${voiceParts.length} 段；bgm = ${bgm ?? "（无）"}`);
  } else if (bgm) {
    banner("叠加纯音乐 BGM（未找到口播旁白，跑 demo:store-ad:vo 可加配音）");
    addBgmOnly({ bgm, totalSec });
    console.log("bgm =", bgm);
  } else {
    execFileSync("ffmpeg", ["-y", "-i", CONCAT_OUTPUT_PATH, "-c", "copy", FINAL_OUTPUT_PATH], {
      stdio: "inherit",
    });
  }

  console.log(`\n成片 ≈ ${totalSec.toFixed(1)}s`);
  console.log("finalLocalPath =", FINAL_OUTPUT_PATH);
  console.log("publicUrl =", "/generated/aivora-digital-human-pet-store-30s-9x16.mp4");

  if (isTruthy(process.env.UPLOAD_STORE_AD_TO_BLOB)) {
    const url = await uploadToBlob(FINAL_OUTPUT_PATH);
    console.log("finalBlobUrl =", url);
  }
}

/* ------------------------------------------------------------------ */
/* ffmpeg 帮助函数                                                     */
/* ------------------------------------------------------------------ */

function renderCaptionPng(caption: string, id: string, font: string): string | null {
  if (!caption.trim()) return null;
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

/** 归一化一段视频到 1080x1920 + 烧字幕 + 静音轨（便于 concat）。 */
function buildClip(opts: {
  input: string;
  output: string;
  durationSec: number;
  caption: string;
  font: string;
  trimStartSec: number;
}) {
  const { input, output, durationSec, caption, font, trimStartSec } = opts;
  const captionPng = renderCaptionPng(caption, basename(output, ".mp4"), font);

  const base =
    `[0:v]fps=${FPS},scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
    `crop=${OUT_W}:${OUT_H},setsar=1,format=yuv420p`;
  const filter = captionPng
    ? `${base}[bg];[bg][1:v]overlay=0:0:format=auto[v]`
    : `${base}[v]`;

  const inputArgs = [
    ...(trimStartSec > 0 ? ["-ss", trimStartSec.toFixed(2)] : []),
    "-t",
    durationSec.toFixed(2),
    "-i",
    input,
  ];
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

/** 品牌尾卡：logo 图做缓慢推镜（Ken Burns）。 */
function buildEndcardClip(image: string, output: string) {
  const frames = Math.round(ENDCARD_DURATION_SEC * FPS);
  const kenBurns =
    `[0:v]scale=4000:-1,zoompan=z='min(zoom+0.0006,1.12)':d=${frames}:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${OUT_W}x${OUT_H}:fps=${FPS},setsar=1,format=yuv420p[v]`;
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loop",
      "1",
      "-i",
      image,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex",
      kenBurns,
      "-map",
      "[v]",
      "-map",
      "1:a:0",
      "-t",
      ENDCARD_DURATION_SEC.toFixed(2),
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

function addBgmOnly(opts: { bgm: string; totalSec: number }) {
  const { bgm, totalSec } = opts;
  const fadeOutStart = Math.max(0, totalSec - 2);
  const gain = Number(process.env.STORE_AD_BGM_GAIN) || 0.8;
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
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把门店原图上传到 Blob，得到公网 URL（供 Seedance reference 模式作场景参考）。
 * 结果缓存到 store-refs.json，重跑不重复上传（除非 STORE_AD_FORCE_REUPLOAD）。
 */
async function ensureStoreRefs(): Promise<StoreRefsFile> {
  const cached = readJsonIfExists<StoreRefsFile>(STORE_REFS_PATH);
  const force = isTruthy(process.env.STORE_AD_FORCE_REUPLOAD);
  const keys = Object.keys(STORE_REF_FILE) as StoreRefKey[];
  if (cached && !force && keys.every((k) => cached.urls[k])) {
    return cached;
  }
  const storage = getStorageProvider();
  const urls: Partial<Record<StoreRefKey, string>> = { ...(cached?.urls ?? {}) };
  for (const k of keys) {
    if (urls[k] && !force) continue;
    assertFile(STORE_REF_FILE[k], `门店图 ${k}`);
    const buf = readFileSync(STORE_REF_FILE[k]);
    const { url } = await storage.uploadBuffer("renders", buf, {
      key: `digital-human-store-ad/store-refs/${k}-${Date.now()}.png`,
      contentType: "image/png",
      access: "public",
    });
    urls[k] = url;
    console.log(`· 门店参考图 ${k} → ${url}`);
  }
  const file: StoreRefsFile = { updatedAt: new Date().toISOString(), urls };
  writeFileSync(STORE_REFS_PATH, JSON.stringify(file, null, 2), "utf8");
  return file;
}

/**
 * Seedance 2.0 多模态参考的中文提示词：图片1=虚拟模特，图片2=门店。
 * 复用分镜里的 keyframePrompt（场景）+ motionPrompt（动作）+ 全局运镜风格。
 */
function buildReferencePrompt(
  shot: StoreAdShot & { keyframeUrl?: string },
  motionStyle: string,
): string {
  return [
    "图片1中的年轻女生作为出镜探店博主，自然地置身于图片2这家浅蓝白粉色系的猫咪主题宠物店里。",
    `画面只有她一个人，真实探店 vlog 质感，自然光，竖屏 9:16，不要出现其他人或文字水印。`,
    shot.keyframePrompt ? `Scene: ${shot.keyframePrompt}` : "",
    `Action: ${shot.motionPrompt}`,
    motionStyle,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 按分镜顺序收集口播旁白段，并算出每段在成片中的起始秒（与 normalized clip 顺序一致）。 */
function collectVoiceParts(
  storyboard: StoryboardFile,
): Array<{ path: string; startSec: number }> {
  const parts: Array<{ path: string; startSec: number }> = [];
  let cursor = 0;
  for (const shot of storyboard.shots) {
    const vo = resolve(VOICEOVER_DIR, `vo-${shot.id}.mp3`);
    if (existsSync(vo) && statSync(vo).size > 0) {
      parts.push({ path: vo, startSec: cursor });
    }
    cursor += shot.durationSec;
  }
  return parts;
}

/**
 * 终混：口播旁白为主轨（按分镜起始时间对齐），BGM 压低垫底，整体做 loudnorm。
 */
function addVoiceoverAndBgm(opts: {
  voiceParts: Array<{ path: string; startSec: number }>;
  bgm: string | null;
  totalSec: number;
}) {
  const { voiceParts, bgm, totalSec } = opts;
  const voGain = Number(process.env.STORE_AD_VO_GAIN) || 1.0;
  const bgmGain = Number(process.env.STORE_AD_BGM_DUCK_GAIN) || 0.15;
  const fadeOutStart = Math.max(0, totalSec - 2);

  const args: string[] = ["-y", "-i", CONCAT_OUTPUT_PATH];
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
    filters.push(
      `${voLabels}amix=inputs=${voiceParts.length}:normalize=0:dropout_transition=0[vomix]`,
    );
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
      FINAL_OUTPUT_PATH,
    ],
    { stdio: "inherit" },
  );
}

async function prepareInput(input: string, id: string): Promise<string> {
  if (isRemoteUrl(input)) {
    const out = resolve(SEGMENT_DIR, `seg-${id}.mp4`);
    if (existsSync(out) && statSync(out).size > 0 && !isTruthy(process.env.STORE_AD_FORCE_REDOWNLOAD)) {
      return out;
    }
    const res = await fetch(input);
    if (!res.ok) throw new Error(`下载 ${id} 失败：${res.status} ${res.statusText}`);
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    return out;
  }
  const local = input.startsWith("file://") ? input.slice("file://".length) : input;
  const resolved = isAbsolute(local) ? local : resolve(process.cwd(), local);
  assertFile(resolved, id);
  return resolved;
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

function writeConcatList(paths: string[]) {
  const body = paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(CONCAT_LIST_PATH, `${body}\n`, "utf8");
}

function resolveFont(): string {
  const found = FONT_CANDIDATES.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      `找不到中文字体。请设置 STORE_AD_CAPTION_FONT 指向中文字体文件。已尝试：${FONT_CANDIDATES.join(", ")}`,
    );
  }
  console.log("captionFont =", found);
  return found;
}

function resolveBgm(): string | null {
  const raw = process.env.STORE_AD_BGM;
  if (raw === "none") return null;
  if (raw) {
    const resolved = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
    if (!existsSync(resolved)) throw new Error(`STORE_AD_BGM 文件不存在：${resolved}`);
    return resolved;
  }
  if (existsSync(DEFAULT_BGM_PATH)) return DEFAULT_BGM_PATH;
  return null;
}

async function uploadToBlob(path: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("UPLOAD_STORE_AD_TO_BLOB=true 需要 BLOB_READ_WRITE_TOKEN");
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

function persistSubmission(s: SubmissionFile) {
  s.updatedAt = new Date().toISOString();
  writeFileSync(SUBMISSION_PATH, JSON.stringify(s, null, 2), "utf8");
}

function readJson<T>(path: string, hint: string): T {
  if (!existsSync(path)) throw new Error(`缺少 ${basename(path)}：${hint}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function assertFile(path: string, label: string) {
  if (!existsSync(path)) throw new Error(`${label} 不存在：${path}`);
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function readFlag(name: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return arg ? arg.split("=")[1] : undefined;
}

/// --only-shot 支持单个或逗号分隔多个镜头（如 --only-shot=01-storefront,05-counter）
function parseOnlyShots(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function isRemoteUrl(v: string) {
  return v.startsWith("http://") || v.startsWith("https://");
}

function isTruthy(v?: string) {
  const n = v?.toLowerCase();
  return n === "1" || n === "true" || n === "yes";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

main().catch((err) => {
  console.error("\n数字人探店广告生成失败：");
  console.error((err as Error).message);
  process.exit(1);
});
