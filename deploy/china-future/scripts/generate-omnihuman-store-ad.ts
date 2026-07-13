/**
 * 数字人探店广告 · OmniHuman 真·对口型交付脚本
 * ==================================================================
 *
 * 与 generate-digital-human-store-ad.ts（Seedance i2v，嘴型自由发挥、不对口型）不同，
 * 本脚本走火山引擎 OmniHuman「单图 + 音频 → 对口型视频」，让数字人**真正按中文配音
 * 对口型说话**：
 *
 *   1) keyframes  gpt-image-1 images.edit 把模特图合成进每个真实门店场景，产出
 *                 「模特在门店里」的 9:16 关键帧（落公网 URL）。
 *   2) audio      复用 demo:store-ad:vo 生成的逐镜中文配音 vo-{id}.mp3，上传成公网 URL。
 *   3) submit     每个 model_store 镜头 → OmniHuman(keyframeUrl, audioUrl) → 对口型视频。
 *   4) wait       轮询 OmniHuman 至全部完成。
 *   5) stitch     下载对口型片段（自带人声）+ 复用橘猫产品空镜（铺该镜配音）→ 归一化
 *                 → 拼接 → BGM 压低垫底 → 追加品牌尾卡 → 成片（无烧录字幕）。
 *
 * 前置依赖（真实出片必须）：
 *   - VOLCENGINE_ACCESS_KEY_ID / VOLCENGINE_SECRET_ACCESS_KEY（已开通 OmniHuman）
 *   - OPENAI_API_KEY（合成关键帧）
 *   - 火山 TTS 凭证（生成配音；见 demo:store-ad:vo）
 *   - 公网存储：BLOB_READ_WRITE_TOKEN 或火山 TOS（VOLCENGINE_TOS_*）
 *   - 已先跑过： npm run demo:store-ad:keyframes  且  npm run demo:store-ad:vo
 *
 * 用法：
 *   tsx scripts/generate-omnihuman-store-ad.ts                 # 跑完整流程
 *   tsx scripts/generate-omnihuman-store-ad.ts --phase=keyframes
 *   tsx scripts/generate-omnihuman-store-ad.ts --phase=submit
 *   tsx scripts/generate-omnihuman-store-ad.ts --phase=wait
 *   tsx scripts/generate-omnihuman-store-ad.ts --phase=stitch
 *   tsx scripts/generate-omnihuman-store-ad.ts --only-shot=02-catroom
 *
 * 成片：public/generated/aivora-omnihuman-pet-store-9x16.mp4
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

import {
  submitOmniHumanJob,
  getOmniHumanStatus,
  isOmniHumanConfigured,
} from "../src/lib/providers/omnihuman";
import { getStorageProvider } from "../src/lib/storage";
import type {
  StoreAdShot,
  StoreRefKey,
} from "../src/lib/video-generation/digital-human/store-ad-director";

/// store-ad-director 与 openai-image 都会（直接或间接）触达在模块加载时实例化的
/// OpenAI 单例（读 OPENAI_API_KEY）。loadEnvConfig 在静态 import 之后才跑，所以这两个
/// 模块都「env 加载后再动态导入」，否则会拿到占位 key 报 401。
type DirectorModule = typeof import("../src/lib/video-generation/digital-human/store-ad-director");
type ImageModule = typeof import("../src/lib/providers/openai-image");
let _director: DirectorModule | null = null;
let _image: ImageModule | null = null;
async function director(): Promise<DirectorModule> {
  if (!_director) {
    _director = await import(
      "../src/lib/video-generation/digital-human/store-ad-director"
    );
  }
  return _director;
}
async function imageProvider(): Promise<ImageModule> {
  if (!_image) {
    _image = await import("../src/lib/providers/openai-image");
  }
  return _image;
}

/* ------------------------------------------------------------------ */
/* 路径与常量                                                          */
/* ------------------------------------------------------------------ */

/// 复用 Seedance 流程已生成的 storyboard.json 与 voiceover/（避免重复跑分镜/配音）。
const SHARED_DIR = resolve(process.cwd(), "tmp/digital-human-store-ad");
const STORYBOARD_PATH = resolve(SHARED_DIR, "storyboard.json");
const VOICEOVER_DIR = resolve(SHARED_DIR, "voiceover");

/// OmniHuman 专属工件目录（与 Seedance 流程互不污染）。
const WORK_DIR = resolve(process.cwd(), "tmp/omnihuman-store-ad");
const KEYFRAME_DIR = resolve(WORK_DIR, "keyframes");
const SEGMENT_DIR = resolve(WORK_DIR, "segments");
const NORMALIZED_DIR = resolve(WORK_DIR, "normalized");
const SUBMISSION_PATH = resolve(WORK_DIR, "omni-submission.json");
const CONCAT_LIST_PATH = resolve(WORK_DIR, "concat-list.txt");
const CONCAT_OUTPUT_PATH = resolve(WORK_DIR, "concat-with-voice.mp4");

const STORE_ASSET_DIR = resolve(process.cwd(), "public/demo/pet-store");
const PUBLIC_OUTPUT_DIR = resolve(process.cwd(), "public/generated");
const FINAL_OUTPUT_PATH = resolve(
  PUBLIC_OUTPUT_DIR,
  "aivora-omnihuman-pet-store-9x16.mp4",
);
const ENDCARD_IMAGE = resolve(process.cwd(), "public/demo/pet/aivora-logo-endcard.png");
const DEFAULT_BGM_PATH = resolve(process.cwd(), "scripts/assets/pet-kit-bgm.mp3");
const CAT_CUTAWAY_PATH = resolve(
  process.cwd(),
  "public/generated/pet-evidence-highlight.mp4",
);

const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const ENDCARD_DURATION_SEC = 3;

const STORE_REF_FILE: Record<StoreRefKey, string> = {
  "store-1": resolve(STORE_ASSET_DIR, "store-1.png"),
  "store-2": resolve(STORE_ASSET_DIR, "store-2.png"),
  "store-3": resolve(STORE_ASSET_DIR, "store-3.png"),
};
const MODEL_FILE = resolve(STORE_ASSET_DIR, "model.png");

const VIDEO_ENCODE_ARGS = isTruthy(process.env.STORE_AD_USE_X264)
  ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
  : ["-c:v", "h264_videotoolbox", "-b:v", "8M", "-pix_fmt", "yuv420p"];

/* ------------------------------------------------------------------ */
/* 持久化类型                                                          */
/* ------------------------------------------------------------------ */

type StoryboardFile = {
  shots: Array<StoreAdShot & { keyframeUrl?: string }>;
};

type SubmissionFile = {
  reqKey: string;
  updatedAt: string;
  shots: Array<{
    id: string;
    keyframeUrl?: string;
    audioUrl?: string;
    externalJobId?: string;
    status?: "pending" | "processing" | "completed" | "failed";
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

/* ---------------------- 阶段 1：合成「模特在门店」关键帧 -------------------- */

async function runKeyframes(onlyShot?: string) {
  banner("阶段 1 / 关键帧：gpt-image 把模特合成进门店场景（OmniHuman 形象图）");
  const { isImageGenAvailable, composeReferenceImage } = await imageProvider();
  if (!isImageGenAvailable()) {
    throw new Error(
      "关键帧合成需要 OPENAI_API_KEY（且 IMAGE_ENGINE_MOCK!=true）。",
    );
  }
  assertFile(MODEL_FILE, "模特图 model.png");
  ensureDir(KEYFRAME_DIR);

  const { KEYFRAME_STYLE } = await director();
  const storyboard = readStoryboard();
  const onlyShots = parseOnlyShots(onlyShot);
  const modelBuf = readFileSync(MODEL_FILE);

  for (const shot of storyboard.shots) {
    if (shot.sceneType !== "model_store") continue;
    if (onlyShots && !onlyShots.includes(shot.id)) continue;
    if (!shot.storeRef) throw new Error(`${shot.id} 缺少 storeRef`);
    assertFile(STORE_REF_FILE[shot.storeRef], `门店图 ${shot.storeRef}`);
    const storeBuf = readFileSync(STORE_REF_FILE[shot.storeRef]);

    const prompt = [
      KEYFRAME_STYLE,
      shot.keyframePrompt ? `Shot intent: ${shot.keyframePrompt}` : "",
      "Front-facing, upper-body / waist-up framing, the woman clearly facing the camera",
      "with her full face visible and well lit — this still will drive a talking-head video.",
    ]
      .filter(Boolean)
      .join(" ");

    console.log(`· ${shot.id} 合成关键帧（store=${shot.storeRef}）...`);
    const { url } = await composeReferenceImage({
      prompt,
      referenceImages: [
        { data: modelBuf, fileName: "model.png", mimeType: "image/png" },
        { data: storeBuf, fileName: `${shot.storeRef}.png`, mimeType: "image/png" },
      ],
      size: "1024x1536",
      blobPrefix: `omnihuman-store-ad/keyframes/${shot.id}-`,
    });
    shot.keyframeUrl = url;
    console.log(`  → ${url}`);
  }

  writeFileSync(STORYBOARD_PATH, JSON.stringify(storyboard, null, 2), "utf8");
  console.log("storyboard.json 已更新（写入 keyframeUrl）");
}

/* ---------------------- 阶段 2：提交 OmniHuman 对口型 ---------------------- */

async function runSubmit(onlyShot?: string) {
  banner("阶段 2 / 提交：OmniHuman 单图音频驱动（关键帧 + 中文配音 → 对口型）");
  if (!isOmniHumanConfigured()) {
    throw new Error(
      "OmniHuman 未配置：需要 VOLCENGINE_ACCESS_KEY_ID / VOLCENGINE_SECRET_ACCESS_KEY，" +
        "且账号已开通「智能视觉服务 + OmniHuman」。",
    );
  }
  const onlyShots = parseOnlyShots(onlyShot);
  const storyboard = readStoryboard();
  const reqKey = process.env.VOLC_OMNIHUMAN_REQ_KEY?.trim() || "(默认)";

  const prev = readJsonIfExists<SubmissionFile>(SUBMISSION_PATH);
  const submission: SubmissionFile = {
    reqKey,
    updatedAt: new Date().toISOString(),
    shots: storyboard.shots
      .filter((s) => s.sceneType === "model_store")
      .map((s) => {
        const old = prev?.shots.find((p) => p.id === s.id);
        return {
          id: s.id,
          keyframeUrl: s.keyframeUrl,
          audioUrl: old?.audioUrl,
          externalJobId: old?.externalJobId,
          status: old?.status,
          videoUrl: old?.videoUrl,
          errorMessage: old?.errorMessage,
        };
      }),
  };

  for (const shot of storyboard.shots) {
    if (shot.sceneType !== "model_store") continue;
    if (onlyShots && !onlyShots.includes(shot.id)) continue;
    const slot = submission.shots.find((p) => p.id === shot.id)!;
    if (slot.videoUrl && !onlyShots) {
      console.log(`· ${shot.id} 已完成，跳过`);
      continue;
    }
    if (!shot.keyframeUrl) {
      throw new Error(`${shot.id} 缺少 keyframeUrl，请先跑 --phase=keyframes`);
    }
    const audioUrl = await ensureAudioUrl(shot.id);
    slot.keyframeUrl = shot.keyframeUrl;
    slot.audioUrl = audioUrl;

    console.log(`· ${shot.id} 提交 OmniHuman（req_key=${reqKey}）...`);
    const { jobId } = await submitOmniHumanJob({
      imageUrl: shot.keyframeUrl,
      audioUrl,
      prompt: "自然、亲切的探店讲解表情，口型清晰，画面稳定真实。",
    });
    slot.externalJobId = jobId;
    slot.status = "pending";
    slot.videoUrl = undefined;
    slot.errorMessage = undefined;
    console.log(`  → task_id=${jobId}`);
    persistSubmission(submission);
  }
  persistSubmission(submission);
}

/* ---------------------------- 阶段 3：轮询 ------------------------ */

async function runWait() {
  banner("阶段 3 / 轮询：等待 OmniHuman 全部完成");
  const submission = readJson<SubmissionFile>(SUBMISSION_PATH, "请先跑 --phase=submit");
  const pollIntervalMs = 15_000;
  const maxMinutes = 20;
  const deadline = Date.now() + maxMinutes * 60_000;

  const pending = () =>
    submission.shots.filter(
      (s) => s.externalJobId && s.status !== "completed" && s.status !== "failed",
    );

  while (pending().length > 0 && Date.now() < deadline) {
    for (const slot of pending()) {
      const r = await getOmniHumanStatus(slot.externalJobId!);
      slot.status = r.status;
      if (r.status === "completed") {
        slot.videoUrl = r.videoUrl;
        console.log(`✔ ${slot.id} 完成`);
      } else if (r.status === "failed") {
        slot.errorMessage = r.errorMessage;
        console.error(`x ${slot.id} 失败：${r.errorMessage}`);
      } else {
        console.log(`… ${slot.id} ${r.rawProviderStatus || r.status}`);
      }
    }
    persistSubmission(submission);
    if (pending().length > 0) await sleep(pollIntervalMs);
  }

  const failed = submission.shots.filter((s) => s.status === "failed");
  const incomplete = submission.shots.filter(
    (s) => s.externalJobId && !s.videoUrl && s.status !== "failed",
  );
  if (failed.length) {
    console.error(`有 ${failed.length} 个镜头失败：`, failed.map((f) => f.id).join(", "));
  }
  if (incomplete.length) {
    throw new Error(
      `${incomplete.length} 个镜头在 ${maxMinutes} 分钟内未完成：${incomplete
        .map((s) => s.id)
        .join(", ")}`,
    );
  }
  if (failed.length) {
    throw new Error("有镜头失败，修复后用 --only-shot 重做对应镜头");
  }
  console.log("全部镜头完成。");
}

/* ---------------------------- 阶段 4：拼接 ------------------------ */

async function runStitch() {
  banner("阶段 4 / 拼接：对口型片段（自带人声）+ 橘猫空镜 + BGM + 品牌尾卡");
  ensureTools();
  ensureDir(SEGMENT_DIR);
  ensureDir(NORMALIZED_DIR);
  ensureDir(PUBLIC_OUTPUT_DIR);

  const storyboard = readStoryboard();
  const submission = readJson<SubmissionFile>(SUBMISSION_PATH, "请先跑 submit/wait");

  const normalizedPaths: string[] = [];
  for (const shot of storyboard.shots) {
    const out = resolve(NORMALIZED_DIR, `clip-${shot.id}.mp4`);
    if (shot.sceneType === "product_cutaway") {
      assertFile(CAT_CUTAWAY_PATH, "橘猫产品空镜");
      const voPath = voiceoverPath(shot.id);
      const dur = voPath ? probeDurationSec(voPath) : shot.durationSec;
      buildCutawayClip({
        input: CAT_CUTAWAY_PATH,
        output: out,
        durationSec: dur,
        voicePath: voPath,
        trimStartSec: 1.0,
      });
    } else {
      const slot = submission.shots.find((s) => s.id === shot.id);
      const src = slot?.videoUrl;
      if (!src) throw new Error(`${shot.id} 缺少 OmniHuman videoUrl（先 submit/wait）`);
      const local = await prepareInput(src, shot.id);
      buildTalkingClip({ input: local, output: out });
    }
    console.log(`clip ${shot.id} → ${out}`);
    normalizedPaths.push(out);
  }

  const useEndcard =
    process.env.STORE_AD_ENDCARD !== "none" && existsSync(ENDCARD_IMAGE);
  if (useEndcard) {
    const endOut = resolve(NORMALIZED_DIR, "clip-99-endcard.mp4");
    buildEndcardClip(ENDCARD_IMAGE, endOut);
    normalizedPaths.push(endOut);
    console.log(`clip 99-endcard → ${endOut}`);
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
    banner("混音：保留各段对口型人声 + 压低 BGM 垫底");
    mixVoiceWithBgm({ bgm, totalSec });
    console.log("bgm =", bgm);
  } else {
    execFileSync("ffmpeg", ["-y", "-i", CONCAT_OUTPUT_PATH, "-c", "copy", FINAL_OUTPUT_PATH], {
      stdio: "inherit",
    });
  }

  console.log(`\n成片 ≈ ${totalSec.toFixed(1)}s`);
  console.log("finalLocalPath =", FINAL_OUTPUT_PATH);
  console.log("publicUrl =", "/generated/aivora-omnihuman-pet-store-9x16.mp4");

  if (isTruthy(process.env.UPLOAD_STORE_AD_TO_BLOB)) {
    const url = await uploadToBlob(FINAL_OUTPUT_PATH);
    console.log("finalBlobUrl =", url);
  }
}

/* ------------------------------------------------------------------ */
/* ffmpeg 帮助函数                                                     */
/* ------------------------------------------------------------------ */

/** 归一化一段 OmniHuman 对口型视频到 1080x1920，保留其自带人声（对口型音频）。 */
function buildTalkingClip(opts: { input: string; output: string }) {
  const { input, output } = opts;
  const vf =
    `fps=${FPS},scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
    `crop=${OUT_W}:${OUT_H},setsar=1,format=yuv420p`;
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      input,
      "-vf",
      vf,
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

/** 产品空镜（无数字人）：橘猫片段裁成竖版，铺该镜中文配音作人声。 */
function buildCutawayClip(opts: {
  input: string;
  output: string;
  durationSec: number;
  voicePath: string | null;
  trimStartSec: number;
}) {
  const { input, output, durationSec, voicePath, trimStartSec } = opts;
  const vf =
    `fps=${FPS},scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
    `crop=${OUT_W}:${OUT_H},setsar=1,format=yuv420p`;

  const inputArgs = [
    ...(trimStartSec > 0 ? ["-ss", trimStartSec.toFixed(2)] : []),
    "-t",
    durationSec.toFixed(2),
    "-i",
    input,
  ];
  if (voicePath) inputArgs.push("-i", voicePath);
  else inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  const audioMap = "1:a:0";

  execFileSync(
    "ffmpeg",
    [
      "-y",
      ...inputArgs,
      "-vf",
      vf,
      "-map",
      "0:v:0",
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
      "-shortest",
      output,
    ],
    { stdio: "inherit" },
  );
}

/** 品牌尾卡：logo 图做缓慢推镜（Ken Burns），静音（由 BGM 覆盖）。 */
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

/** 在已含人声的拼接视频下，混入压低的 BGM 垫底，整体做 loudnorm。 */
function mixVoiceWithBgm(opts: { bgm: string; totalSec: number }) {
  const { bgm, totalSec } = opts;
  const bgmGain = Number(process.env.STORE_AD_BGM_DUCK_GAIN) || 0.15;
  const fadeOutStart = Math.max(0, totalSec - 2);
  const filter = [
    `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,` +
      `atrim=0:${totalSec.toFixed(2)},volume=${bgmGain},` +
      `afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2[bg]`,
    `[0:a]aformat=sample_rates=44100:channel_layouts=stereo[voice]`,
    `[voice][bg]amix=inputs=2:normalize=0:duration=first[mix]`,
    `[mix]loudnorm=I=-16:TP=-1.5:LRA=11[a]`,
  ].join(";");

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
      filter,
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

/** 把某镜的本地配音 mp3 上传成公网 URL（供 OmniHuman 下载作驱动音频）。 */
async function ensureAudioUrl(shotId: string): Promise<string> {
  const local = voiceoverPath(shotId);
  if (!local) {
    throw new Error(
      `缺少配音 vo-${shotId}.mp3，请先跑 npm run demo:store-ad:vo（生成逐镜中文配音）。`,
    );
  }
  const storage = getStorageProvider();
  if (!storage.isConfigured()) {
    throw new Error(
      `Storage provider "${storage.id}" 未配置；无法把配音上传成公网 URL 供 OmniHuman 下载。`,
    );
  }
  const buf = readFileSync(local);
  const { url } = await storage.uploadBuffer("renders", buf, {
    key: `omnihuman-store-ad/audio/${shotId}-${Date.now()}.mp3`,
    contentType: "audio/mpeg",
    access: "public",
  });
  console.log(`  · 配音 ${shotId} → ${url}`);
  return url;
}

function voiceoverPath(shotId: string): string | null {
  const p = resolve(VOICEOVER_DIR, `vo-${shotId}.mp3`);
  return existsSync(p) && statSync(p).size > 0 ? p : null;
}

async function prepareInput(input: string, id: string): Promise<string> {
  if (isRemoteUrl(input)) {
    const out = resolve(SEGMENT_DIR, `seg-${id}.mp4`);
    if (
      existsSync(out) &&
      statSync(out).size > 0 &&
      !isTruthy(process.env.STORE_AD_FORCE_REDOWNLOAD)
    ) {
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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function writeConcatList(paths: string[]) {
  const body = paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(CONCAT_LIST_PATH, `${body}\n`, "utf8");
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
}

function readStoryboard(): StoryboardFile {
  if (!existsSync(STORYBOARD_PATH)) {
    throw new Error(
      `缺少 storyboard.json：请先跑 npm run demo:store-ad:keyframes（生成分镜）。`,
    );
  }
  return JSON.parse(readFileSync(STORYBOARD_PATH, "utf8")) as StoryboardFile;
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
  console.error("\nOmniHuman 探店广告生成失败：");
  console.error((err as Error).message);
  process.exit(1);
});
