/**
 * 提交 Aivora 宠物内容智能采集套件 60 秒讲解视频到即梦/Seedance。
 *
 * 4 段 × 15 秒 = 60 秒，16:9 横屏。画面保持干净（不渲染任何文字），
 * 中文字幕与 BGM 在 stitch 阶段用 ffmpeg 烧录。
 *
 * 用法：
 *   npm run demo:gen:petkit                 # 全量提交（需 BYTEPLUS_ARK_API_KEY）
 *   npm run demo:gen:petkit -- --segments=2 # 仅重提某段
 *   npm run demo:gen:petkit -- --mock       # 显式 mock（仅本地调试）
 *
 * 提交后用 `npm run demo:check:petkit` 轮询，全部完成再 `npm run demo:stitch:petkit`。
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { submitSeedanceJob } from "../src/lib/providers/seedance";

loadEnvConfig(process.cwd());

const DOC_PATH = resolve(process.cwd(), "docs/PET_CONTENT_KIT_60S_DEMO_VIDEO.md");
const OUTPUT_DIR = resolve(process.cwd(), "tmp/pet-kit-walkthrough-video");
const SUBMISSION_PATH = resolve(OUTPUT_DIR, "submission.json");
const DEFAULT_SEGMENT_DURATION_SEC = 15;

type WalkthroughSegment = {
  index: number;
  timeRange: string;
  title: string;
  /// 烧录用中文字幕（不在 Seedance prompt 里渲染）
  caption: string;
  prompt: string;
};

type SubmissionRecord = {
  purpose: "pet-content-kit-60s-walkthrough";
  provider: "SEEDANCE_T2V";
  submittedAt: string;
  updatedAt: string;
  mode: "segmented";
  ratio: "16:9";
  segmentDurationSec: number;
  totalTargetDurationSec: number;
  model: string;
  promptSource: string;
  statusCommand: "npm run demo:check:petkit";
  stitchCommand: "npm run demo:stitch:petkit";
  segments: Array<{
    index: number;
    timeRange: string;
    title: string;
    caption: string;
    externalJobId?: string;
    submittedAt?: string;
    status?: "submitted" | "failed";
    seedanceStatus?: "pending" | "processing" | "completed" | "failed";
    progress?: number;
    videoUrl?: string;
    thumbnailUrl?: string;
    errorMessage?: string;
  }>;
};

const SHARED_STYLE = [
  "16:9 landscape, cinematic.",
  "Warm, cozy, premium, pet-friendly mood.",
  "Cream white, warm beige and soft orange palette with subtle deep teal accents.",
  "Realistic warm home interiors, soft natural light, shallow depth of field.",
  "Cute cats and small dogs with natural, adorable behavior.",
  "Absolutely NO text, NO captions, NO subtitles, NO watermark, NO logos, NO UI text, NO fake brand names rendered anywhere in the frame.",
  "No close-up human faces; if a person appears, show only hands, back, or silhouette.",
  "No graphic charts, no percentages, no performance numbers.",
].join(" ");

const SEGMENTS: WalkthroughSegment[] = [
  {
    index: 1,
    timeRange: "0-15s",
    title: "真实瞬间被采集",
    caption: "真实瞬间，自动被记录",
    prompt:
      "Create segment 1 of a four-part warm product story for an AI pet content kit. Show a cozy sunlit home where an adorable cat goes about its day: eating from a bowl, napping by the window, chasing a feather toy. On a shelf in the background sits a small, modern, minimalist home camera quietly working. Convey that smart hardware gently captures real, candid pet moments without disturbing them. Slow, warm, heartwarming. Do NOT render any text, captions, watermarks, or logos.",
  },
  {
    index: 2,
    timeRange: "15-30s",
    title: "AI 识别可爱与产品片段",
    caption: "AI 自动挑出最可爱、最值得分享的片段",
    prompt:
      "Create segment 2 of a four-part warm product story for an AI pet content kit. Show the highlight moments of the same cute cat: an adorable head tilt, rolling playfully on a soft plush pet mat. Use gentle glowing soft-focus halos to elegantly emphasize these cute moments, as if an AI is tenderly noticing the best frames. Warm cozy tones, dreamy and lovable. Do NOT render any text, captions, watermarks, logos, or UI elements.",
  },
  {
    index: 3,
    timeRange: "30-45s",
    title: "自动生成可分享视频与日记",
    caption: "一键生成可爱视频和宠物日记",
    prompt:
      "Create segment 3 of a four-part warm product story for an AI pet content kit. Show a vertical smartphone on a cozy warm desk playing an adorable pet clip, with a warm pet-diary style card beside it (treat any card as abstract warm shapes, NOT readable text). Plants, a soft blanket, golden light, healing atmosphere. Convey that cute shareable videos and a pet diary are generated automatically. Do NOT render any readable text, captions, watermarks, logos, or UI text.",
  },
  {
    index: 4,
    timeRange: "45-60s",
    title: "分享裂变 + 品牌证据 + 社区",
    caption: "分享带来增长，真实使用成为品牌证据",
    prompt:
      "Create segment 4 of a four-part warm product story for an AI pet content kit. Show a phone sharing a cute pet video outward, then a warm montage of several different pet owners' cozy homes and happy pets, intercut with a pet genuinely using a product (resting on a warm heated mat). End on a warm, inviting community feeling. Convey that owners love sharing (low-cost growth) and real usage becomes trustworthy brand proof. Do NOT render any text, captions, watermarks, logos, or UI text.",
  },
];

async function main() {
  const allowMock = hasFlag("--mock") || isTruthy(process.env.ALLOW_WALKTHROUGH_MOCK);
  assertSeedanceEnvironment({ allowMock });
  assertSourceDocExists();

  const segmentDurationSec = readSegmentDurationSec();
  const model = process.env.ARK_VIDEO_MODEL || "dreamina-seedance-2-0-260128";
  const selectedSegmentIndexes = readSelectedSegmentIndexes();
  const selectedSegments = SEGMENTS.filter((segment) =>
    selectedSegmentIndexes.includes(segment.index),
  );

  banner("提交 Aivora 宠物套件讲解视频到 Seedance");
  console.log("provider = SEEDANCE_T2V");
  console.log("ratio = 16:9");
  console.log("segments =", SEGMENTS.length);
  console.log("selectedSegments =", selectedSegmentIndexes.join(","));
  console.log("segmentDurationSec =", segmentDurationSec);
  console.log("model =", model);
  if (allowMock) console.warn("mock = true (explicitly requested)");

  ensureDir(OUTPUT_DIR);
  const record =
    selectedSegmentIndexes.length === SEGMENTS.length
      ? createSubmissionRecord({ segmentDurationSec, model })
      : readExistingSubmissionRecord({ segmentDurationSec, model });
  writeSubmission(record);

  for (const segment of selectedSegments) {
    const prompt = buildSegmentPrompt(segment, segmentDurationSec);
    banner(`提交第 ${segment.index}/4 段：${segment.title}`);
    console.log("timeRange =", segment.timeRange);
    console.log("promptChars =", prompt.length);

    try {
      const submitted = await submitSeedanceJob({
        prompt,
        duration: segmentDurationSec,
        ratio: "16:9",
        model,
        generateAudio: false,
      });
      console.log("externalJobId =", submitted.jobId);
      updateSegment(record, segment.index, {
        externalJobId: submitted.jobId,
        submittedAt: new Date().toISOString(),
        status: "submitted",
        seedanceStatus: undefined,
        progress: undefined,
        videoUrl: undefined,
        thumbnailUrl: undefined,
        errorMessage: undefined,
      });
      writeSubmission(record);
    } catch (err) {
      const errorMessage = (err as Error).message;
      const existing = record.segments.find((item) => item.index === segment.index);
      if (!existing?.externalJobId) {
        updateSegment(record, segment.index, { status: "failed", errorMessage });
        writeSubmission(record);
      }
      throw new Error(
        `第 ${segment.index} 段（${segment.title}）提交失败：${errorMessage}`,
      );
    }
  }

  banner("已提交所选片段");
  for (const segment of record.segments) {
    console.log(
      `segment ${segment.index} ${segment.timeRange} externalJobId = ${segment.externalJobId}`,
    );
  }
  console.log("localRecord =", SUBMISSION_PATH);
  console.log("checkStatus =", "npm run demo:check:petkit");
  console.log("stitchWhenReady =", "npm run demo:stitch:petkit");
}

function assertSeedanceEnvironment({ allowMock }: { allowMock: boolean }) {
  const missing: string[] = [];
  if (!process.env.BYTEPLUS_ARK_API_KEY && !allowMock) missing.push("BYTEPLUS_ARK_API_KEY");

  const mockFlag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  const mockEnabled = mockFlag === "1" || mockFlag === "true" || mockFlag === "yes";
  if (mockEnabled && !allowMock) {
    throw new Error(
      [
        "VIDEO_ENGINE_MOCK 已开启，真实提交被中止。",
        "请将 VIDEO_ENGINE_MOCK 设为 false 或取消它再做真实提交。",
        "只有在确实需要 mock 时才用 --mock 或 ALLOW_WALKTHROUGH_MOCK=true。",
      ].join("\n"),
    );
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `缺少 Seedance 必需环境变量：${missing.join(", ")}`,
        "- BYTEPLUS_ARK_API_KEY 用于真实 Seedance 提交。",
        "- ARK_BASE_URL 可选，默认 https://ark.ap-southeast.bytepluses.com/api/v3。",
        "- ARK_VIDEO_MODEL 可选，默认 dreamina-seedance-2-0-260128。",
      ].join("\n"),
    );
  }
}

function assertSourceDocExists() {
  if (!existsSync(DOC_PATH)) {
    throw new Error(`缺少分镜文档：${DOC_PATH}`);
  }
}

function readSegmentDurationSec() {
  const raw = process.env.PETKIT_SEEDANCE_DURATION_SEC;
  if (!raw) return DEFAULT_SEGMENT_DURATION_SEC;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`PETKIT_SEEDANCE_DURATION_SEC 非法：${raw}`);
  }
  return parsed;
}

function readSelectedSegmentIndexes() {
  const segmentsArg = process.argv.find((arg) => arg.startsWith("--segments="));
  if (!segmentsArg) return SEGMENTS.map((segment) => segment.index);

  const rawIndexes = segmentsArg.slice("--segments=".length).split(",");
  const indexes = rawIndexes.map((raw) => Number(raw.trim()));
  const unique = [...new Set(indexes)];
  const valid = new Set(SEGMENTS.map((segment) => segment.index));
  if (
    unique.length === 0 ||
    unique.some((index) => !Number.isInteger(index) || !valid.has(index))
  ) {
    throw new Error(
      `--segments 非法：${segmentsArg}，应为如 --segments=1,2,4 的子集。`,
    );
  }
  return unique.sort((a, b) => a - b);
}

function createSubmissionRecord({
  segmentDurationSec,
  model,
}: {
  segmentDurationSec: number;
  model: string;
}): SubmissionRecord {
  return {
    purpose: "pet-content-kit-60s-walkthrough",
    provider: "SEEDANCE_T2V",
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: "segmented",
    ratio: "16:9",
    segmentDurationSec,
    totalTargetDurationSec: SEGMENTS.length * segmentDurationSec,
    model,
    promptSource: DOC_PATH,
    statusCommand: "npm run demo:check:petkit",
    stitchCommand: "npm run demo:stitch:petkit",
    segments: SEGMENTS.map((segment) => ({
      index: segment.index,
      timeRange: segment.timeRange,
      title: segment.title,
      caption: segment.caption,
    })),
  };
}

function readExistingSubmissionRecord({
  segmentDurationSec,
  model,
}: {
  segmentDurationSec: number;
  model: string;
}) {
  if (!existsSync(SUBMISSION_PATH)) {
    throw new Error(
      [
        `缺少已存在的提交记录：${SUBMISSION_PATH}`,
        "请先做一次全量提交，或省略 --segments 以新建记录。",
      ].join("\n"),
    );
  }
  const record = JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;
  record.segmentDurationSec = segmentDurationSec;
  record.totalTargetDurationSec = SEGMENTS.length * segmentDurationSec;
  record.model = model;
  record.promptSource = DOC_PATH;
  record.updatedAt = new Date().toISOString();
  return record;
}

function buildSegmentPrompt(segment: WalkthroughSegment, durationSec: number) {
  return [
    segment.prompt,
    "",
    "Shared style constraints:",
    SHARED_STYLE,
    "",
    "Camera movement:",
    "Smooth push-ins, gentle slides, soft parallax, warm and calm pacing.",
    "",
    "Music mood (for reference only, audio will be added later):",
    "Warm, gentle, heartwarming, light acoustic.",
    "",
    "Output:",
    `16:9 landscape, ${segment.timeRange}, approximately ${durationSec} seconds.`,
  ].join("\n");
}

function updateSegment(
  record: SubmissionRecord,
  index: number,
  patch: Partial<SubmissionRecord["segments"][number]>,
) {
  const segment = record.segments.find((item) => item.index === index);
  if (!segment) throw new Error(`缺少片段记录：${index}`);
  Object.assign(segment, patch);
  record.updatedAt = new Date().toISOString();
}

function writeSubmission(record: SubmissionRecord) {
  writeFileSync(SUBMISSION_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function isTruthy(value?: string) {
  const normalized = value?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

main().catch((err) => {
  console.error("\n宠物套件讲解视频提交失败：");
  console.error((err as Error).message);
  process.exit(1);
});
