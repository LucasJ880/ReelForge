import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { submitSeedanceJob } from "../src/lib/providers/seedance";

loadEnvConfig(process.cwd());

const DOC_PATH = resolve(
  process.cwd(),
  "docs/REAL_FOOTAGE_AD_AGENT_60S_DEMO_VIDEO.md",
);
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-footage-walkthrough-video");
const SUBMISSION_PATH = resolve(OUTPUT_DIR, "submission.json");
const DEFAULT_SEGMENT_DURATION_SEC = 15;

type WalkthroughSegment = {
  index: number;
  timeRange: string;
  title: string;
  overlays: string[];
  voiceover: string;
  prompt: string;
};

type SubmissionRecord = {
  purpose: "real-footage-ads-60s-walkthrough";
  provider: "SEEDANCE_T2V";
  submittedAt: string;
  updatedAt: string;
  mode: "segmented";
  ratio: "16:9";
  segmentDurationSec: number;
  totalTargetDurationSec: number;
  model: string;
  promptSource: string;
  statusCommand: "npm run demo:check:walkthrough";
  stitchCommand: "npm run demo:stitch:walkthrough";
  segments: Array<{
    index: number;
    timeRange: string;
    title: string;
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
  "16:9 landscape.",
  "Premium B2B SaaS visual style.",
  "Dark interface with clean neon teal accents.",
  "Smooth UI transitions with abstract dashboard mockups.",
  "Avoid detailed small UI text, tiny tables, fake filenames, and pseudo-readable copy.",
  "Use mostly visual cards, thumbnails, icons, shapes, neutral labels, bars, dots, and trend lines.",
  "No copyrighted logos.",
  "No TikTok logos or platform logo lockups.",
  "No fake brand names or fake customer names.",
  "Do not render the brand name Aivora unless it is large, simple, and only shown once.",
  "No percentages, ROI numbers, growth numbers, or dramatic performance charts.",
  "No fake performance lift claims, ROI claims, or guaranteed conversion claims.",
  "No claims that publishing is fully automated.",
].join(" ");

const SEGMENTS: WalkthroughSegment[] = [
  {
    index: 1,
    timeRange: "0-15s",
    title: "Problem + Upload",
    overlays: [
      "Messy footage in",
      "Upload raw clips",
    ],
    voiceover:
      "Small businesses already have the footage. What they don’t have is a fast way to turn it into ads they can test.",
    prompt:
      "Create segment 1 of a four-part real-footage ads walkthrough video. Show messy real product footage clips floating on a dark SaaS background: storefront, product close-up, food or service clip, shelf detail, and handheld customer or pet reaction footage. Then transition to a clean upload panel with generic video file cards represented mostly as abstract cards, thumbnails, icons, and shapes. Do NOT render detailed UI text. Do NOT use the brand name in this segment. Use only two large, simple overlays with exact spelling: first show “Messy footage in”, then show “Upload raw clips”. Avoid small text, fake filenames, generated UI labels, percentages, ROI numbers, and fake performance claims. Voiceover: “Small businesses already have the footage. What they don’t have is a fast way to turn it into ads they can test.”",
  },
  {
    index: 2,
    timeRange: "15-30s",
    title: "Footage Index + 5 Concepts",
    overlays: [
      "Find usable moments",
      "Create 5 ad concepts",
    ],
    voiceover:
      "Raw clips become usable shots, then five different ad concepts are ready to review.",
    prompt:
      "Create segment 2 of a four-part real-footage ads walkthrough video. Show raw clips turning into thumbnail tiles and simple abstract tags. Then show five clean ad concept cards as visual cards using mostly icons, shapes, thumbnails, and large labels. Do NOT render the brand name Aivora. Do NOT render tiny hook, audience, score, or CTA text. Use only two large, simple overlays with exact spelling: first show “Find usable moments”, then show “Create 5 ad concepts”. The five cards may use only these large simple tags: “Hook”, “Demo”, “Trust”, “Offer”, “CTA”. Avoid gibberish, small text, percentages, ROI numbers, scores, growth charts, and fake performance claims. Voiceover: “Raw clips become usable shots, then five different ad concepts are ready to review.”",
  },
  {
    index: 3,
    timeRange: "30-45s",
    title: "AI Review + Render",
    overlays: [
      "AI review before publishing.",
      "Render 9:16 ads ready for testing.",
    ],
    voiceover:
      "Each concept is reviewed before publishing, then rendered into a short-form video ready for testing.",
    prompt:
      "Create segment 3 of a four-part Aivora Real-Footage Ads walkthrough video. Show an AI Reviewer scorecard with an overall score, strengths, improvement suggestions, and five scoring dimensions: hook, clarity, footage match, pacing, and technical quality. Then show a vertical 9:16 short-form ad preview rendering inside the dashboard, moving from Rendering to Ready. Include clean captions, product or store footage, and a simple CTA inside the preview. Overlay text timing: first show “AI review before publishing.” then show “Render 9:16 ads ready for testing.” Voiceover: “Each concept is reviewed before publishing, then rendered into a short-form video ready for testing.”",
  },
  {
    index: 4,
    timeRange: "45-60s",
    title: "Metrics + Next Round + CTA",
    overlays: [
      "Learn from metrics",
      "Request demo access",
    ],
    voiceover:
      "After publishing, metrics come back into the system, so the next round gets smarter. Bring your own messy footage, and see what Aivora can create.",
    prompt:
      "Create segment 4 of a four-part real-footage ads walkthrough video. Show a simple metrics dashboard using abstract bars, dots, and restrained trend lines. Do NOT show percentages. Do NOT show ROI or growth numbers. Do NOT show dramatic growth charts. Show a winner card and next-round idea using abstract UI only, with neutral labels and no numeric claims. End on a clean CTA screen. The brand name Aivora may appear only once on the final CTA screen if it is large, simple, and spelled exactly “Aivora”. Use only two large, simple overlays with exact spelling: first show “Learn from metrics”, then show “Request demo access”. If any numeric UI is shown, use neutral labels only, no numbers. Avoid gibberish, tiny text tables, automatic publishing claims, and fake performance claims. Voiceover: “After publishing, metrics come back into the system, so the next round gets smarter. Bring your own messy footage, and see what Aivora can create.”",
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

  banner("Submitting segmented Aivora walkthrough to Seedance");
  console.log("provider = SEEDANCE_T2V");
  console.log("ratio = 16:9");
  console.log("mode = segmented");
  console.log("segments =", SEGMENTS.length);
  console.log("selectedSegments =", selectedSegmentIndexes.join(","));
  console.log("segmentDurationSec =", segmentDurationSec);
  console.log("totalTargetDurationSec =", SEGMENTS.length * segmentDurationSec);
  console.log("model =", model);
  console.log("promptSource =", DOC_PATH);
  if (allowMock) {
    console.warn("mock = true (explicitly requested)");
  }

  ensureDir(OUTPUT_DIR);
  const record =
    selectedSegmentIndexes.length === SEGMENTS.length
      ? createSubmissionRecord({ segmentDurationSec, model })
      : readExistingSubmissionRecord({ segmentDurationSec, model });
  writeSubmission(record);

  for (const segment of selectedSegments) {
    const prompt = buildSegmentPrompt(segment);
    banner(`Submitting segment ${segment.index}/4: ${segment.title}`);
    console.log("timeRange =", segment.timeRange);
    console.log("promptChars =", prompt.length);

    try {
      const submitted = await submitSeedanceJob({
        prompt,
        duration: segmentDurationSec,
        ratio: "16:9",
        model,
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
      const existingSegment = record.segments.find((item) => item.index === segment.index);
      if (!existingSegment?.externalJobId) {
        updateSegment(record, segment.index, {
          status: "failed",
          errorMessage,
        });
        writeSubmission(record);
      }
      throw new Error(
        `Segment ${segment.index} (${segment.title}) submission failed: ${errorMessage}`,
      );
    }
  }

  banner("Submitted selected segments");
  for (const segment of record.segments) {
    console.log(
      `segment ${segment.index} ${segment.timeRange} externalJobId = ${segment.externalJobId}`,
    );
  }
  console.log("localRecord =", SUBMISSION_PATH);
  console.log("checkStatus =", "npm run demo:check:walkthrough");
  console.log("stitchWhenReady =", "npm run demo:stitch:walkthrough");
}

function assertSeedanceEnvironment({ allowMock }: { allowMock: boolean }) {
  const missing: string[] = [];
  if (!process.env.BYTEPLUS_ARK_API_KEY && !allowMock) {
    missing.push("BYTEPLUS_ARK_API_KEY");
  }

  const mockFlag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  const mockEnabled =
    mockFlag === "1" || mockFlag === "true" || mockFlag === "yes";

  if (mockEnabled && !allowMock) {
    throw new Error(
      [
        "Seedance real submission aborted because VIDEO_ENGINE_MOCK is enabled.",
        "Set VIDEO_ENGINE_MOCK=false or unset it for real Seedance submission.",
        "Only use --mock or ALLOW_WALKTHROUGH_MOCK=true if you explicitly want a mock job.",
      ].join("\n"),
    );
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing required Seedance env vars: ${missing.join(", ")}`,
        "Expected env configuration:",
        "- BYTEPLUS_ARK_API_KEY is required for real Seedance submission.",
        "- ARK_BASE_URL is optional; provider defaults to https://ark.ap-southeast.bytepluses.com/api/v3.",
        "- ARK_VIDEO_MODEL is optional; provider defaults to dreamina-seedance-2-0-260128.",
        "- VIDEO_ENGINE_MOCK must not be true for a real submission.",
      ].join("\n"),
    );
  }
}

function assertSourceDocExists() {
  if (!existsSync(DOC_PATH)) {
    throw new Error(`Missing walkthrough prompt source doc: ${DOC_PATH}`);
  }
}

function readSegmentDurationSec() {
  const raw = process.env.WALKTHROUGH_SEEDANCE_DURATION_SEC;
  if (!raw) return DEFAULT_SEGMENT_DURATION_SEC;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid WALKTHROUGH_SEEDANCE_DURATION_SEC value: ${raw}`,
    );
  }

  return parsed;
}

function readSelectedSegmentIndexes() {
  const segmentsArg = process.argv.find((arg) => arg.startsWith("--segments="));
  if (!segmentsArg) return SEGMENTS.map((segment) => segment.index);

  const rawIndexes = segmentsArg.slice("--segments=".length).split(",");
  const indexes = rawIndexes.map((raw) => Number(raw.trim()));
  const unique = [...new Set(indexes)];
  const validIndexes = new Set(SEGMENTS.map((segment) => segment.index));

  if (
    unique.length === 0 ||
    unique.some((index) => !Number.isInteger(index) || !validIndexes.has(index))
  ) {
    throw new Error(
      `Invalid --segments value: ${segmentsArg}. Expected a comma-separated subset such as --segments=1,2,4.`,
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
    purpose: "real-footage-ads-60s-walkthrough",
    provider: "SEEDANCE_T2V",
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: "segmented",
    ratio: "16:9",
    segmentDurationSec,
    totalTargetDurationSec: SEGMENTS.length * segmentDurationSec,
    model,
    promptSource: DOC_PATH,
    statusCommand: "npm run demo:check:walkthrough",
    stitchCommand: "npm run demo:stitch:walkthrough",
    segments: SEGMENTS.map((segment) => ({
      index: segment.index,
      timeRange: segment.timeRange,
      title: segment.title,
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
        `Missing existing submission record for selective regeneration: ${SUBMISSION_PATH}`,
        "Run the full submission once, or omit --segments to create a new tracking record.",
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

function buildSegmentPrompt(segment: WalkthroughSegment) {
  return [
    segment.prompt,
    "",
    "Shared style constraints:",
    SHARED_STYLE,
    "",
    "Camera movement:",
    "Smooth push-ins, lateral slides, gentle zooms, subtle parallax, clean dashboard transitions, large readable overlay text only.",
    "",
    "Music mood:",
    "Modern light electronic, clean, confident, premium SaaS, no aggressive hype.",
    "",
    "Output:",
    `16:9 landscape, ${segment.timeRange}, approximately ${readSegmentDurationSec()} seconds.`,
  ].join("\n");
}

function updateSegment(
  record: SubmissionRecord,
  index: number,
  patch: Partial<SubmissionRecord["segments"][number]>,
) {
  const segment = record.segments.find((item) => item.index === index);
  if (!segment) throw new Error(`Missing segment record: ${index}`);
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
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

main().catch((err) => {
  const message = (err as Error).message;
  console.error("\nWalkthrough Seedance submission failed:");
  console.error(message);
  if (message.includes("duration") && message.includes("not valid")) {
    console.error(
      [
        "",
        "Seedance rejected the requested duration.",
        "This script defaults to 4 segmented clips. Retry with a provider-supported per-segment duration if needed:",
        "  WALKTHROUGH_SEEDANCE_DURATION_SEC=10 npm run demo:generate:walkthrough",
        "Do not set DEMO_WALKTHROUGH_VIDEO_URL until a completed final video URL exists.",
      ].join("\n"),
    );
  }
  process.exit(1);
});
