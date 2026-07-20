/**
 * Real-provider acceptance · 20 视频批量验收（第 2 部分：2 × 30s 拼接）。
 *
 * 每条 30s = 2 段 15s 火山 Seedance 2.0 真实生成（连贯性锁定的 A/B 段，Omni-Reference）→
 * stitch-service.runFfmpegNormalizeAndConcat 归一化拼接 →
 * OpenAI whisper 转写实际语音 → PIL 渲染字幕 PNG → ffmpeg overlay 烧录，
 * 保证「字幕 = 实际口播」严格一致。
 *
 * 覆盖点：
 *   - EN 条：数字人风格女顾问口播（加拿大英语客群）
 *   - ZH 条：痛点→解决中文口播（本地华人商家客群）
 *   - 拼接转场（15s 边界）与音画一致性
 *
 * 用法：npx tsx scripts/real-video-acceptance-30s.ts
 * 断点续跑：JSON 报告 + provider Idempotency-Key。
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { put } from "@vercel/blob";
import { SeedanceRuntimeAdapter } from "@/lib/providers/seedance";
import { VOLCENGINE_CN_ARK_BASE_URL } from "@/lib/config/seedance-runtime";
import { runFfmpegNormalizeAndConcat } from "@/lib/services/stitch-service";
import {
  findUnsafeShutterPromptViolations,
  renderSafeShutterPrompt,
} from "@/lib/video-generation/shutter-shot-policy";
import {
  parseStoryboardArtifact,
  requireStoryboardBeforeVideo,
  type Image2StoryboardArtifact,
} from "@/lib/video-generation/storyboard-lock";

// dev 模式加载 env：.env.production.local 里是轮转前的过期 DB 凭证。
loadEnvConfig(process.cwd(), true);
process.env.VIDEO_ENGINE_MOCK = "false";
process.env.VIDEO_PROVIDER = "byteplus";
process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
process.env.ARK_BASE_URL = VOLCENGINE_CN_ARK_BASE_URL;
process.env.ARK_VIDEO_MODEL = "doubao-seedance-2-0-260128";

const SEEDANCE_MODEL = "doubao-seedance-2-0-260128";
const seedance = new SeedanceRuntimeAdapter("volcengine_cn_legacy", SEEDANCE_MODEL);

const RUN_KEY = "real-acceptance-20260719-volc-30s-v1";
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-video-acceptance");
const REPORT_PATH = resolve(OUTPUT_DIR, "30s-v1.json");
const VIDEO_DIR = resolve(OUTPUT_DIR, "30s-videos-v1");
const POLL_MS = 20_000;
const MAX_WAIT_MS = 60 * 60_000;
const CAPTION_RENDERER = resolve(process.cwd(), "scripts/render-caption-png.py");

const SOURCE_PATHS = [
  "/Users/evan/Downloads/2024-11-14 14.10.56.jpg", // 1 白色百叶窗整墙+顶部横窗 深色地板
  "/Users/evan/Downloads/2024-11-14 14.10.46.jpg", // 2 黑框百叶窗客厅+黑色玻璃法式门
  "/Users/evan/Downloads/2024-03-14 11.55.01.jpeg", // 3 白色百叶窗转角落地 公寓
  "/Users/evan/Downloads/2024-01-31 10.39.03.jpeg", // 4 白色厨房台面上窗
  "/Users/evan/Downloads/2026-04-29 16.04.00.jpg", // 5 白色百叶窗整墙(亮)
  "/Users/evan/Downloads/2024-03-07 15.33.02.jpeg", // 6 棕墙卧室三窗+水晶吊灯
  "/Users/evan/Downloads/2024-01-23 14.47.09.jpeg", // 7 奶油色餐厅整墙百叶窗
] as const;

const EN_PRESENTER =
  "one friendly Canadian home-design consultant, woman in her mid-30s, shoulder-length auburn hair, warm genuine smile, fitted navy blazer over a plain white top, small stud earrings, no other jewelry";

const ZH_PRESENTER =
  "one relatable East Asian woman around 30, shoulder-length straight black hair, oversized light-grey cotton loungewear, natural no-makeup look";

type SegmentSpec = {
  key: string; // providerRequestKey suffix
  imageIdx: number[]; // 0-based into SOURCE_PATHS
  prompt: string;
  /// true = 提交时把上一段成片的末帧作为 image 1 身份参考注入（跨段人物一致性锁）。
  /// prompt 里的 image 编号需按「image 1=身份参考」手工对齐。
  chainIdentity?: boolean;
};

type VideoSpec = {
  id: "en-consultant" | "zh-pain-solution";
  language: "en" | "zh";
  segments: [SegmentSpec, SegmentSpec];
  /// 口播脚本台词（字幕真值）：whisper 只负责时间轴，字幕文本以此为准，
  /// 避免同音字转写错误上片（实测「量尺」→「凉蠢」这类广告事故）。
  scriptedLines: string[];
};

const VIDEOS: VideoSpec[] = [
  {
    id: "en-consultant",
    language: "en",
    scriptedLines: [
      "These are custom plantation shutters — and they completely transformed this condo.",
      "Solid louvers, one smooth touch — full control of light and privacy.",
      "Each panel is measured and built for this exact window.",
      "Every panel folds back whenever you want the full view.",
      "Morning glare? Just tilt. It is that easy.",
      "Custom shutters, made to measure for Canadian homes.",
      "Book your free in-home quote today.",
    ],
    segments: [
      {
        key: "en-a",
        imageIdx: [0, 4],
        prompt: renderSafeShutterPrompt({
          motion: "presenter_point_only",
          productName: "white custom plantation shutters",
          productLock:
            "LOCATION: the exact condo room in image 1 and image 2 — a full wall of white plantation shutters with a louvered transom row above, dark hardwood floor, white walls. Preserve product geometry from the references.",
          characterLock: EN_PRESENTER,
          voiceLock:
            "warm spoken Canadian English lines exactly as scripted, quiet room ambience, no music",
          microExpressionLock: "warm genuine smile; never exaggerated faces",
          beats: [
            '0-5s: she walks into frame beside the shutter wall, points at it without touching, and says: "These are custom plantation shutters — and they completely transformed this condo."',
            '5-10s: medium shot — shutters stay static while soft daylight stripes the floor; she gestures toward the wall (no contact) and says: "Solid louvers, one smooth touch — full control of light and privacy."',
            '10-15s: wider shot, she stands by the window and says: "Each panel is measured and built for this exact window."',
          ],
        }),
      },
      {
        key: "en-b2",
        imageIdx: [2, 3],
        chainIdentity: true,
        prompt: renderSafeShutterPrompt({
          motion: "panel_hinge_open",
          productName: "white custom plantation shutters",
          productLock:
            "image 1 is the presenter identity frame from the previous scene. LOCATION: image 2 corner floor-to-ceiling white plantation shutters (light hardwood, baseboard heater) and image 3 kitchen counter window with white plantation shutters. Preserve product geometry.",
          characterLock: `${EN_PRESENTER}. The woman MUST remain 100% identical to image 1 — same face, hair, outfit.`,
          voiceLock:
            "warm spoken Canadian English lines exactly as scripted, quiet room ambience, no music",
          microExpressionLock: "confident soft smile on the final CTA beat",
          beats: [
            '0-5s: at the corner windows of image 2, one whole shutter panel slowly swings open on side hinges to reveal the view (no hand on tilt bar) while she says: "Every panel folds back whenever you want the full view."',
            '5-10s: kitchen of image 3 — shutters static or all louvers already half-closed with NO hands in frame; soft light on the counter; she says: "Morning glare? Just tilt. It is that easy."',
            '10-15s: medium shot to camera: "Custom shutters, made to measure for Canadian homes. Book your free in-home quote today."',
          ],
        }),
      },
    ],
  },
  {
    id: "zh-pain-solution",
    language: "zh",
    scriptedLines: [
      "每天早上都被晒醒，真的受不了了",
      "装了实木百叶窗，一拨就搞定，太省心了",
      "角度随便调，光线刚刚好，隐私也有了",
      "定制百叶窗，上门量尺安装，家里颜值直接拉满",
    ],
    segments: [
      {
        key: "zh-a",
        imageIdx: [5, 0],
        prompt: renderSafeShutterPrompt({
          motion: "panel_hinge_open",
          productName: "white custom plantation shutters",
          productLock:
            "LOCATION: bedroom in image 1 (warm tan walls, three tall windows with white plantation shutters, crystal chandelier) and room in image 2 with a full wall of white plantation shutters. Preserve product geometry.",
          characterLock: ZH_PRESENTER,
          voiceLock:
            "natural spoken Mandarin Chinese lines exactly as scripted, room ambience, no music",
          microExpressionLock:
            "annoyed squint then relieved half-smile; no exaggerated cartoon faces",
          beats: [
            '0-5s: harsh morning sun through open louvers onto the bed; she squints awake, shields her eyes, says: "每天早上都被晒醒，真的受不了了。"',
            "5-10s: she walks to the window; one whole shutter panel slowly swings toward closed on its hinges (door-like). Hands may lightly guide the panel edge only — never the thin tilt bar. Room softens into shade.",
            '10-15s: she turns to camera, relieved, says: "装了实木百叶窗，一拨就搞定，太省心了。"',
          ],
        }),
      },
      {
        key: "zh-b",
        imageIdx: [6, 1],
        prompt: renderSafeShutterPrompt({
          motion: "louver_tilt_no_hands",
          productName: "custom plantation shutters",
          productLock:
            "LOCATION: image 1 cream dining area with plantation shutters over patio door; image 2 living room with black-framed plantation shutters and black French doors. Preserve each room's shutter finish from references.",
          characterLock: ZH_PRESENTER,
          voiceLock:
            "natural spoken Mandarin Chinese lines exactly as scripted, room ambience, no music",
          microExpressionLock: "pleased recommending smile on the CTA beat",
          beats: [
            '0-5s: dining area of image 1 — all louvers slowly tilt together as one unit with NO hands in frame; soft striped light on the floor; she says from medium shot: "角度随便调，光线刚刚好，隐私也有了。"',
            "5-10s: living room of image 2 — slow pan across black-framed shutters (static product), striped shadows drifting.",
            '10-15s: she stands by the black shutters, looks to camera: "定制百叶窗，上门量尺安装，家里颜值直接拉满。"',
          ],
        }),
      },
    ],
  },
];

for (const video of VIDEOS) {
  for (const segment of video.segments) {
    const violations = findUnsafeShutterPromptViolations(segment.prompt);
    if (violations.length > 0) {
      throw new Error(
        `Unsafe shutter prompt in ${video.id}/${segment.key}: ${violations
          .map((v) => v.code)
          .join(", ")}`,
      );
    }
  }
}

type SegmentState = {
  key: string;
  taskId?: string;
  status?: string;
  outputUrl?: string | null;
  localPath?: string | null;
  error?: string | null;
};

type VideoState = {
  id: string;
  language: string;
  segments: SegmentState[];
  stitchedBlobUrl?: string | null;
  stitchedLocalPath?: string | null;
  transcript?: Array<{ start: number; end: number; text: string }>;
  /// 实际烧录的字幕（whisper 时间轴 + 脚本台词对齐后的文本）
  captions?: Array<{ start: number; end: number; text: string }>;
  captionedLocalPath?: string | null;
  captionedBlobUrl?: string | null;
  error?: string | null;
};

type Report = {
  runKey: string;
  purpose: "2x30s-stitched-voiceover-caption-acceptance";
  startedAt: string;
  finishedAt?: string;
  sourceAssets: Array<{ id: string; localPath: string; blobUrl: string }>;
  videos: VideoState[];
};

function readReport(): Report | null {
  if (!existsSync(REPORT_PATH)) return null;
  return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;
}

function writeReport(report: Report): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function mimeType(path: string): "image/jpeg" {
  const extension = extname(path).toLowerCase();
  if (extension !== ".jpg" && extension !== ".jpeg") {
    throw new Error(`Unsupported source image: ${path}`);
  }
  return "image/jpeg";
}

async function uploadAssets(existing: Report | null) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required");
  }
  const existingByPath = new Map(
    existing?.sourceAssets.map((asset) => [asset.localPath, asset]) ?? [],
  );
  const assets: Report["sourceAssets"] = [];
  for (const [index, localPath] of SOURCE_PATHS.entries()) {
    if (!existsSync(localPath)) throw new Error(`Missing source image: ${localPath}`);
    const prior = existingByPath.get(localPath);
    if (prior) {
      assets.push(prior);
      continue;
    }
    const objectName = `real-video-acceptance/${RUN_KEY}/source-${index + 1}-${basename(localPath)}`;
    const blob = await put(objectName, readFileSync(localPath), {
      access: "public",
      contentType: mimeType(localPath),
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    assets.push({
      id: `${RUN_KEY}-source-${index + 1}`,
      localPath,
      blobUrl: blob.url,
    });
    console.log(`uploaded source ${index + 1}/${SOURCE_PATHS.length}`);
  }
  return assets;
}

function ensureProviderConfigured(): void {
  if (!seedance.isConfigured()) {
    throw new Error(
      "Volcengine legacy Seedance runtime is not configured (ARK_API_KEY / VIDEO_ENGINE_MOCK)",
    );
  }
}

/**
 * Image2 storyboard-first: shutter acceptance must not submit Seedance until
 * gpt-image-2 (or manual) keyframes exist. Place JSON at:
 *   tmp/real-video-acceptance/storyboard.json
 * or set ACCEPTANCE_STORYBOARD_JSON=/path/to/storyboard.json
 *
 * Canonical shape: { source, purpose, frames: [{ id, order, imageUrl }] }
 * Also accepts investor-demo StoryboardRecord ({ segments with blobUrl }).
 */
function loadAcceptanceStoryboard(): Image2StoryboardArtifact | null {
  const path =
    process.env.ACCEPTANCE_STORYBOARD_JSON ??
    resolve(OUTPUT_DIR, "storyboard.json");
  if (!existsSync(path)) return null;
  try {
    return parseStoryboardArtifact(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    throw new Error(
      `Invalid acceptance storyboard at ${path}: ${(err as Error).message}`,
    );
  }
}

function assertStoryboardBeforeSeedanceSubmit(): void {
  requireStoryboardBeforeVideo(loadAcceptanceStoryboard(), {
    clientLockProfileId: "sunnyshutter",
    runKind: "shutter_acceptance",
    minFrames: 2,
  });
}

function findFont(): string {
  const candidates = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
  ];
  for (const font of candidates) if (existsSync(font)) return font;
  throw new Error("No CJK-capable font found for caption rendering");
}

/// 本地 whisper.cpp 转写（OpenAI 项目无转写模型权限；离线更稳，带毫秒级时间戳）。
const WHISPER_MODEL =
  process.env.WHISPER_MODEL?.trim() ||
  resolve(process.env.HOME ?? "~", ".cache/whisper-cpp/ggml-small.bin");

function transcribe(
  audioPath: string,
  language: string,
): Array<{ start: number; end: number; text: string }> {
  if (!existsSync(WHISPER_MODEL)) {
    throw new Error(`whisper model missing: ${WHISPER_MODEL}`);
  }
  const outBase = audioPath.replace(/\.wav$/, "");
  execFileSync("whisper-cli", [
    "-m", WHISPER_MODEL,
    "-f", audioPath,
    "-l", language,
    "-oj",
    "-of", outBase,
    "-np",
  ]);
  const payload = JSON.parse(readFileSync(`${outBase}.json`, "utf8")) as {
    transcription?: Array<{
      offsets: { from: number; to: number };
      text: string;
    }>;
  };
  return (payload.transcription ?? [])
    .map((segment) => ({
      start: Math.max(0, segment.offsets.from / 1000),
      end: Math.max(
        segment.offsets.from / 1000 + 0.4,
        segment.offsets.to / 1000,
      ),
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

/// 把 whisper 转写段的文本对齐回口播脚本：二元字组相似度取最优脚本行，
/// 阈值 0.5 以下（whisper 捕捉到脚本外的语音时）保留转写原文兜底。
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(value: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < value.length - 1; i += 1) grams.add(value.slice(i, i + 2));
  return grams;
}

function similarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na.length < 2 || nb.length < 2) return 0;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  for (const gram of ga) if (gb.has(gram)) overlap += 1;
  return overlap / Math.max(1, Math.min(ga.size, gb.size));
}

function alignCaptionsToScript(
  transcript: Array<{ start: number; end: number; text: string }>,
  scriptedLines: string[],
): Array<{ start: number; end: number; text: string }> {
  return transcript.map((segment) => {
    let bestLine: string | null = null;
    let bestScore = 0;
    for (const line of scriptedLines) {
      const score = similarity(segment.text, line);
      if (score > bestScore) {
        bestScore = score;
        bestLine = line;
      }
    }
    return {
      ...segment,
      text: bestScore >= 0.5 && bestLine ? bestLine : segment.text,
    };
  });
}

/// 长字幕拆分：render-caption-png 是单行渲染，超长行会被缩到难以阅读的字号。
/// 超过 maxChars 的字幕在靠中点的标点/空格处拆成两段，时间按字符比例分配。
function splitLongCaptions(
  captions: Array<{ start: number; end: number; text: string }>,
  maxChars: number,
): Array<{ start: number; end: number; text: string }> {
  const result: Array<{ start: number; end: number; text: string }> = [];
  const queue = [...captions];
  while (queue.length > 0) {
    const caption = queue.shift()!;
    if (caption.text.length <= maxChars) {
      result.push(caption);
      continue;
    }
    const mid = Math.floor(caption.text.length / 2);
    let best = -1;
    for (let i = 1; i < caption.text.length - 1; i += 1) {
      if (/[，。！？；、,;.!?—\s·]/.test(caption.text[i])) {
        if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
      }
    }
    if (best <= 0) {
      result.push(caption);
      continue;
    }
    const first = caption.text.slice(0, best + 1).replace(/[—\s]+$/, "").trim();
    const second = caption.text.slice(best + 1).trim();
    if (!first || !second) {
      result.push(caption);
      continue;
    }
    const duration = caption.end - caption.start;
    const cutAt =
      caption.start + duration * (first.length / (first.length + second.length));
    queue.unshift(
      { start: caption.start, end: cutAt, text: first },
      { start: cutAt, end: caption.end, text: second },
    );
  }
  return result;
}

function burnCaptions(args: {
  inputPath: string;
  outputPath: string;
  captions: Array<{ start: number; end: number; text: string }>;
  workDir: string;
}): void {
  const font = findFont();
  const probe = execFileSync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=s=x:p=0",
      args.inputPath,
    ],
    { encoding: "utf8" },
  ).trim();
  const [width, height] = probe.split("x").map(Number);
  const usable = args.captions.filter((caption) => caption.text.length > 0);
  if (usable.length === 0) {
    execFileSync("cp", [args.inputPath, args.outputPath]);
    return;
  }
  const inputs: string[] = ["-i", args.inputPath];
  const filters: string[] = [];
  let lastLabel = "0:v";
  usable.forEach((caption, index) => {
    const captionTxt = resolve(args.workDir, `caption-${index}.txt`);
    const captionPng = resolve(args.workDir, `caption-${index}.png`);
    writeFileSync(captionTxt, caption.text, "utf8");
    execFileSync("python3", [
      CAPTION_RENDERER,
      font,
      captionTxt,
      captionPng,
      String(width),
      String(height),
      "0",
    ]);
    inputs.push("-i", captionPng);
    const nextLabel = index === usable.length - 1 ? "vout" : `v${index + 1}`;
    filters.push(
      `[${lastLabel}][${index + 1}:v]overlay=0:0:enable='between(t,${caption.start.toFixed(2)},${caption.end.toFixed(2)})'[${nextLabel}]`,
    );
    lastLabel = nextLabel;
  });
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel", "error",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[vout]",
    "-map", "0:a:0",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "19",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    args.outputPath,
  ]);
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  ensureProviderConfigured();
  const existing = readReport();
  const sourceAssets = await uploadAssets(existing);
  const report: Report = existing ?? {
    runKey: RUN_KEY,
    purpose: "2x30s-stitched-voiceover-caption-acceptance",
    startedAt: new Date().toISOString(),
    sourceAssets,
    videos: VIDEOS.map((video) => ({
      id: video.id,
      language: video.language,
      segments: video.segments.map((segment) => ({ key: segment.key })),
    })),
  };
  report.sourceAssets = sourceAssets;

  // 0) segment 规格同步：新 key（如身份链重生成）加入，被替换的 key 移除；
  //    发生变化时清空该视频的下游产物强制重拼接/重字幕。
  for (const video of VIDEOS) {
    let state = report.videos.find((row) => row.id === video.id);
    if (!state) {
      state = {
        id: video.id,
        language: video.language,
        segments: video.segments.map((segment) => ({ key: segment.key })),
      };
      report.videos.push(state);
    }
    const nextSegments = video.segments.map(
      (segment) =>
        state.segments.find((row) => row.key === segment.key) ?? { key: segment.key },
    );
    const keysChanged =
      JSON.stringify(state.segments.map((row) => row.key)) !==
      JSON.stringify(nextSegments.map((row) => row.key));
    state.segments = nextSegments;
    if (keysChanged) {
      state.stitchedBlobUrl = null;
      state.stitchedLocalPath = null;
      state.transcript = undefined;
      state.captions = undefined;
      state.captionedLocalPath = null;
      state.captionedBlobUrl = null;
      for (const suffix of [
        "-30s-stitched.mp4",
        "-30s-final.mp4",
        "-audio.wav",
        "-audio.json",
      ]) {
        rmSync(resolve(VIDEO_DIR, `${video.id}${suffix}`), { force: true });
      }
      console.log(`segments changed for ${video.id}; downstream artifacts reset`);
    }
  }
  writeReport(report);

  /// 身份链参考图：上一段成片末帧 → Blob URL
  async function identityRefFor(
    videoId: string,
    prev: SegmentState,
  ): Promise<string> {
    const local = resolve(VIDEO_DIR, `${videoId}-${prev.key}.mp4`);
    if (!existsSync(local)) {
      const response = await fetch(prev.outputUrl!);
      if (!response.ok) throw new Error(`download ${prev.key} for identity ref failed`);
      writeFileSync(local, Buffer.from(await response.arrayBuffer()));
    }
    const framePath = resolve(VIDEO_DIR, `${videoId}-${prev.key}-lastframe.jpg`);
    if (!existsSync(framePath)) {
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-sseof", "-0.25",
        "-i", local,
        "-frames:v", "1",
        "-q:v", "2",
        framePath,
      ]);
    }
    const blob = await put(
      `real-video-acceptance/${RUN_KEY}/${videoId}-${prev.key}-lastframe.jpg`,
      readFileSync(framePath),
      {
        access: "public",
        contentType: "image/jpeg",
        token: process.env.BLOB_READ_WRITE_TOKEN!,
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );
    return blob.url;
  }

  /// 提交所有可提交的 segment（身份链段要等前一段 completed 才能提交）。
  /// 返回尚未提交的数量。
  async function trySubmitPending(): Promise<number> {
    const needsNewSubmit = report.videos.some((state) =>
      state.segments.some((segment) => !segment.taskId),
    );
    if (needsNewSubmit) {
      assertStoryboardBeforeSeedanceSubmit();
    }
    let unsubmitted = 0;
    for (const video of VIDEOS) {
      const state = report.videos.find((row) => row.id === video.id)!;
      for (const [segmentIndex, segment] of video.segments.entries()) {
        const segmentState = state.segments.find((row) => row.key === segment.key)!;
        if (segmentState.taskId) continue;
        const refs: string[] = [];
        if (segment.chainIdentity) {
          const prev = state.segments[segmentIndex - 1];
          if (!prev || prev.status !== "completed" || !prev.outputUrl) {
            unsubmitted += 1;
            continue;
          }
          refs.push(await identityRefFor(video.id, prev));
        }
        refs.push(...segment.imageIdx.map((index) => sourceAssets[index].blobUrl));
        const { jobId } = await seedance.submitResilient({
          prompt: segment.prompt,
          referenceImageUrls: refs,
          mode: "reference",
          duration: 15,
          ratio: "9:16",
          resolution: "720p",
          model: SEEDANCE_MODEL,
          generateAudio: true,
        });
        segmentState.taskId = jobId;
        segmentState.status = "queued";
        writeReport(report);
        console.log(`submitted ${video.id}/${segment.key} -> ${jobId}`);
      }
    }
    return unsubmitted;
  }

  // 1+2) 提交 + 轮询直到全部 terminal（身份链段在前段完成后自动补提交）
  await trySubmitPending();
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    let pending = 0;
    for (const state of report.videos) {
      for (const segmentState of state.segments) {
        if (!segmentState.taskId) continue;
        if (segmentState.status === "completed" || segmentState.status === "failed")
          continue;
        const task = await seedance.getStatus(segmentState.taskId);
        segmentState.status = task.status;
        if (task.status === "completed") {
          segmentState.outputUrl = task.videoUrl ?? null;
          if (!segmentState.outputUrl) {
            segmentState.status = "failed";
            segmentState.error = "completed without output url";
          }
        } else if (task.status === "failed") {
          segmentState.error = task.errorMessage ?? "provider failed";
        } else {
          pending += 1;
        }
      }
    }
    writeReport(report);
    pending += await trySubmitPending();
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        segments: report.videos.flatMap((video) =>
          video.segments.map((segment) => `${segment.key}:${segment.status ?? "unsubmitted"}`),
        ),
      }),
    );
    if (pending === 0) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, POLL_MS));
  }

  // 3) 下载 + 拼接 + 转写 + 字幕
  for (const state of report.videos) {
    const failedSegment = state.segments.find((segment) => segment.status !== "completed");
    if (failedSegment) {
      state.error = `segment ${failedSegment.key} not completed: ${failedSegment.error ?? failedSegment.status}`;
      writeReport(report);
      continue;
    }
    for (const segmentState of state.segments) {
      const path = resolve(VIDEO_DIR, `${state.id}-${segmentState.key}.mp4`);
      if (!existsSync(path)) {
        const response = await fetch(segmentState.outputUrl!);
        if (!response.ok) throw new Error(`download ${segmentState.key} failed`);
        writeFileSync(path, Buffer.from(await response.arrayBuffer()));
      }
      segmentState.localPath = path;
    }
    writeReport(report);

    if (!state.stitchedBlobUrl) {
      const url = await runFfmpegNormalizeAndConcat({
        finalVideoId: `${RUN_KEY}-${state.id}`,
        aspectRatio: "9:16",
        clips: state.segments.map((segmentState) => ({
          url: `file://${segmentState.localPath}`,
          intendedDurationSec: 15,
          trimToFit: false,
        })),
      });
      state.stitchedBlobUrl = url;
      writeReport(report);
    }
    const stitchedLocal = resolve(VIDEO_DIR, `${state.id}-30s-stitched.mp4`);
    if (!existsSync(stitchedLocal)) {
      const response = await fetch(state.stitchedBlobUrl);
      if (!response.ok) throw new Error(`download stitched ${state.id} failed`);
      writeFileSync(stitchedLocal, Buffer.from(await response.arrayBuffer()));
    }
    state.stitchedLocalPath = stitchedLocal;
    writeReport(report);

    // 转写实际语音（字幕 = 真实口播，不是脚本台词）；whisper.cpp 需要 16k 单声道 wav
    const audioPath = resolve(VIDEO_DIR, `${state.id}-audio.wav`);
    if (!existsSync(audioPath)) {
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-i", stitchedLocal,
        "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        audioPath,
      ]);
    }
    if (!state.transcript) {
      state.transcript = transcribe(audioPath, state.language);
      writeReport(report);
    }
    const spec = VIDEOS.find((video) => video.id === state.id)!;
    state.captions = splitLongCaptions(
      alignCaptionsToScript(state.transcript, spec.scriptedLines),
      state.language === "zh" ? 22 : 46,
    );
    writeReport(report);

    const captionedLocal = resolve(VIDEO_DIR, `${state.id}-30s-final.mp4`);
    if (!existsSync(captionedLocal)) {
      burnCaptions({
        inputPath: stitchedLocal,
        outputPath: captionedLocal,
        captions: state.captions,
        workDir: VIDEO_DIR,
      });
    }
    state.captionedLocalPath = captionedLocal;
    if (!state.captionedBlobUrl) {
      const blob = await put(
        `real-video-acceptance/${RUN_KEY}/${state.id}-30s-final.mp4`,
        readFileSync(captionedLocal),
        {
          access: "public",
          contentType: "video/mp4",
          token: process.env.BLOB_READ_WRITE_TOKEN!,
          addRandomSuffix: false,
          allowOverwrite: true,
        },
      );
      state.captionedBlobUrl = blob.url;
    }
    writeReport(report);
  }

  report.finishedAt = new Date().toISOString();
  writeReport(report);
  console.log(JSON.stringify({ reportPath: REPORT_PATH }, null, 2));
  const failed = report.videos.filter((video) => video.error);
  if (failed.length > 0) {
    throw new Error(`${failed.length} 30s videos did not complete; inspect the report`);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
