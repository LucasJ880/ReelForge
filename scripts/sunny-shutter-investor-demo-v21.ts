/**
 * Sunny Shutter Investor Demo Pipeline — V2.1 (image-storyboard-guided I2V)
 * =========================================================================
 *
 * V1 (sunny-shutter-investor-demo.ts) shipped a working pure-T2V pipeline.
 * V2.1 keeps that contract and upgrades the visual continuity by:
 *
 *   1. Generating 5 cinematic 9:16 storyboard frames with OpenAI gpt-image-2
 *      (or accepting hand-curated PNGs in manual mode).
 *   2. Pausing at a STORYBOARD REVIEW GATE so a human approves the look
 *      before any Seedance credits are spent.
 *   3. Submitting each Seedance segment as I2V with the corresponding
 *      storyboard PNG injected as the `first_frame` reference image. This
 *      anchors the room / man / armchair / blinds across all 5 shots.
 *   4. Stripping Seedance audio (generate_audio=false, then ffmpeg
 *      normalize to silent stereo) so the cut isn't ruined by 5 inconsistent
 *      AI ambience tracks. Override with `--keep-audio`.
 *   5. Compositing the real Sunny PNG only post-production:
 *        - top-right watermark via Brand Overlay Layer (full base footage)
 *        - real-logo end card via Brand End Card Renderer (hideCta=true)
 *        - optional, opt-in subtle logo-on-blinds overlay during segment 4
 *   6. Holding back publish-to-/personal/videos by default — the script
 *      stops after final.mp4 is produced and uploaded so the user reviews
 *      before the demo entry is created. `--auto-publish` or
 *      `--phase=publish` lifts the gate.
 *
 * Hard rules (same as V1):
 *   - Sunny logo is NEVER asked of any AI model. Real PNG only, post-prod.
 *   - Storyboard prompts and Seedance prompts both forbid logo / brand text.
 *   - Customer-facing strings remain free of internal pipeline jargon.
 *
 * File layout:
 *   tmp/sunny-shutter-investor-demo/storyboards/        — 5 PNGs (per user spec)
 *   tmp/sunny-shutter-investor-demo-v21/                — script working dir
 *     storyboard.json                                    — image plan + Blob URLs
 *     submission.json                                    — Seedance jobs
 *     state.json                                         — assemble/publish state
 *     raw-seg-N.mp4 / normalized/seg-N.mp4 / base.mp4 / overlay-out/ / final.mp4
 *
 * Phases (idempotent + resumable):
 *
 *   1. storyboard — Generate (or verify) 5 storyboard PNGs at 9:16, upload to
 *                   Vercel Blob, write storyboard.json. Then STOP for review.
 *
 *   2. submit     — For each segment, POST a Seedance I2V job using the
 *                   storyboard Blob URL as first_frame. generate_audio=false.
 *                   submission.json persisted; --resubmit-segment=N targets
 *                   one slot.
 *
 *   3. wait       — Poll Seedance until each segment is completed/failed.
 *
 *   4. assemble   — Download → normalize-to-silent → concat → watermark →
 *                   (optional) logo-on-blinds for seg 4 → real-logo end card
 *                   → final.mp4 → poster → upload to Blob. Then STOP for
 *                   review unless --auto-publish.
 *
 *   5. publish    — Upsert PERSONAL demo user + create/refresh
 *                   DeliveryOrder graph so /personal/videos shows the entry.
 *
 * Usage:
 *   npx tsx scripts/sunny-shutter-investor-demo-v21.ts --phase=storyboard
 *     → generate (or verify) 5 storyboard PNGs, then STOP for review
 *
 *   npx tsx scripts/sunny-shutter-investor-demo-v21.ts
 *     → storyboard → submit → wait → assemble (STOPS before publish)
 *
 *   npx tsx scripts/sunny-shutter-investor-demo-v21.ts --auto-publish
 *     → full pipeline including publish
 *
 *   npx tsx scripts/sunny-shutter-investor-demo-v21.ts --phase=publish
 *     → publish only (after reviewing final.mp4)
 *
 *   Flags:
 *     --auto-publish               publish at end of "all" run
 *     --resubmit-segment=N         clear + re-submit only segment N (1-based)
 *     --logo-on-blinds             apply subtle logo-on-blinds during segment 4
 *     --keep-audio                 keep Seedance audio (default: silent)
 *     --reassemble                 force rebuild of final.mp4 + Blob URLs
 *     --regenerate-storyboards     force re-generate even if PNGs cached
 *     --storyboard-source=openai|manual    (default openai; manual = wait for hand-placed PNGs)
 *     --storyboard-quality=low|medium|high (default medium; high = ~$0.211/image)
 *     --reset-publish              delete prior demo order before publishing
 *     --dry-run                    no Seedance / OpenAI calls
 *     --phase=storyboard|submit|wait|assemble|publish|all
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
/// brand-end-card-renderer chooses local vs deferred-external by NODE_ENV; for
/// this script we always want LOCAL ffmpeg so the end card actually renders.
process.env.STITCH_RUNTIME = process.env.STITCH_RUNTIME || "local";

import { execFile, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { put } from "@vercel/blob";
import bcrypt from "bcryptjs";
import {
  FinalVideoStatus,
  PrismaClient,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";

import { renderBrandEndCard } from "@/lib/video-generation/brand-end-card-renderer";
import { applyBrandOverlay } from "@/lib/video-generation/brand-overlay-renderer";
import { generateImages } from "@/lib/providers/openai-image";
import {
  getSeedanceStatus,
  submitSeedanceJob,
} from "@/lib/providers/seedance";
import type { BrandPackagingPlan } from "@/types/video-generation";

// =============================================================
// Constants
// =============================================================

const PROJECT_ROOT = process.cwd();
/// Per the user spec: storyboards live alongside V1's working dir at this
/// exact path. The V2.1 script's *other* artifacts (raw segments, final mp4,
/// state.json) live in a sibling -v21 dir to avoid clobbering V1 cache.
const STORYBOARD_DIR = path.resolve(
  PROJECT_ROOT,
  "tmp/sunny-shutter-investor-demo/storyboards",
);
const WORK_DIR = path.resolve(
  PROJECT_ROOT,
  "tmp/sunny-shutter-investor-demo-v21",
);
const STORYBOARD_PATH = path.join(WORK_DIR, "storyboard.json");
const SUBMISSION_PATH = path.join(WORK_DIR, "submission.json");
const STATE_PATH = path.join(WORK_DIR, "state.json");
const LOGO_PATH = path.resolve(PROJECT_ROOT, "public/brand/sunny-logo.png");

const ASPECT_RATIO = "9:16" as const;
const TARGET_WIDTH = 720;
const TARGET_HEIGHT = 1280;
const FPS = 30;

/// Storyboard image dimensions: true 9:16, high-resolution vertical.
/// gpt-image-2 requires width and height to both be divisible by 16; 1080x1920
/// is visually nice but invalid because 1080 is not divisible by 16.
/// 1152x2048 is exact 9:16, higher than 1080p vertical, and valid for gpt-image-2.
const STORYBOARD_WIDTH = 1152;
const STORYBOARD_HEIGHT = 2048;
const STORYBOARD_SIZE = `${STORYBOARD_WIDTH}x${STORYBOARD_HEIGHT}`;
const STORYBOARD_MODEL = process.env.OPENAI_STORYBOARD_MODEL || "gpt-image-2";

const BASE_SEGMENT_COUNT = 5;
const BASE_SEGMENT_DURATION_SEC = 5;
const END_CARD_DURATION_SEC = 5;
const TARGET_TOTAL_SEC =
  BASE_SEGMENT_COUNT * BASE_SEGMENT_DURATION_SEC + END_CARD_DURATION_SEC;

const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";

const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL || "demo@aivora.app";
const DEMO_USER_NAME = process.env.DEMO_USER_NAME || "Aivora Demo";
const DEMO_USER_DEFAULT_PASSWORD =
  process.env.DEMO_USER_PASSWORD || "SunnyShutter2026!";

const ORDER_TITLE = "Sunny Shutter — Comfort, with independence.";
const ORDER_DESCRIPTION =
  "A warm 30-second demo showing how motorized blinds can bring comfort, control, and independence into everyday life.";
const BRAND_NAME = "Sunny Shutter";
const BRAND_SLOGAN = "Comfort, with independence.";
const BRAND_WEBSITE = "sunnyshutter.ca";

/// V2.1 — shared visual bible. Prepended to BOTH the gpt-image-2 storyboard
/// prompts AND the Seedance video motion prompts so the room / man / armchair
/// / window / blinds stay continuous across all 5 shots.
const SHARED_VISUAL_BIBLE = [
  "Same modern Canadian suburban living room throughout the entire film.",
  "Same elderly man throughout: early 70s, kind face, silver hair, soft beige knit cardigan or sweater, calm dignified posture.",
  "Same warm morning light, same zebra blinds, same comfortable armchair, same side table with a cup of tea and an open book.",
  "Warm neutral color palette, light oak furniture, white walls, clean uncluttered home.",
  "Premium cinematic realism, 35mm lens feeling, shallow depth of field, realistic skin texture, soft natural morning light, restrained warm color grade.",
  "The emotional tone is quiet, dignified, independent, and human-centered.",
  "No logo, no brand text, no readable on-screen text, no artificial signage generated by the AI model.",
].join(" ");

/// Negative-guidance clause for Seedance video motion prompts. (gpt-image-2
/// has built-in safety + we constrain look via the visual bible directly.)
const SHARED_NEGATIVE_GUIDANCE = [
  "no AI-generated logo",
  "no fake brand text",
  "no unreadable text",
  "no text overlay of any kind",
  "no distorted hands",
  "no extra fingers",
  "no warped blinds",
  "no flickering stripes",
  "no cheesy advertising",
  "no exaggerated acting",
  "no cluttered scene",
  "no over-saturated color",
  "no cartoon style",
  "no unrealistic product movement",
  "no jump cuts inside a single shot",
  "no character drift inside a single shot",
  "premium cinematic commercial style",
  "warm, restrained, human-centered",
].join(", ");

/// Seedance I2V rejects some photorealistic person first_frames (privacy).
/// These shots use T2V (prompt-only) while 1 + 4 stay image-anchored.
const T2V_ONLY_SEGMENT_INDICES = new Set([2, 3, 5]);

// =============================================================
// V2.1 storyboard + segment plan (verbatim from user spec)
// =============================================================

interface StoryboardSegment {
  index: number; /// 1-based for human readability
  timeRange: string;
  title: string;
  filename: string; /// PNG filename under STORYBOARD_DIR
  durationSec: number;
  /// Sent to gpt-image-2 (with shared visual bible prepended)
  imagePrompt: string;
  /// Sent to Seedance I2V as the per-shot motion prompt (shared visual bible
  /// prepended + shared negative guidance appended at submit time)
  videoMotionPrompt: string;
}

const STORYBOARD_PLAN: StoryboardSegment[] = [
  {
    index: 1,
    timeRange: "0–5s",
    title: "The room before control",
    filename: "01-room-before-control.png",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    imagePrompt:
      "Early morning. A quiet premium living room with zebra blinds casting bright warm bands of sunlight across a side table, a cup of tea, and an open book beside a comfortable armchair. The room is beautiful but slightly too bright. No people clearly visible yet. Cinematic 35mm realism, shallow depth of field, soft natural light, restrained warm color grade.",
    videoMotionPrompt:
      "Slow cinematic push-in from the window light toward the chair and side table. The light feels beautiful but slightly too strong. Keep the motion subtle and elegant. No people enter the frame.",
  },
  {
    index: 2,
    timeRange: "5–10s",
    title: "The human need",
    filename: "02-human-need.png",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    imagePrompt:
      "Same armchair, three-quarter rear angle. An elderly figure in a soft beige cardigan sits reading — seen from behind and slightly to the side so the face is not visible (back of silver hair and shoulders only). Bright morning light on the book and chair. Calm, dignified mood. Premium cinematic realism, warm natural light, shallow depth of field. No identifiable facial features, no portrait, no eye contact with camera.",
    videoMotionPrompt:
      "From behind, the figure gently pauses reading and turns slightly toward the bright window. Only subtle shoulder and head movement — face stays off-camera. Calm, composed body language. No exaggerated emotion.",
  },
  {
    index: 3,
    timeRange: "10–15s",
    title: "The quiet act of control",
    filename: "03-quiet-act-of-control.png",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    imagePrompt:
      "Extreme close-up macro: only elderly hands and forearms on a side table, an open book edge, and a softly blurred smartphone. No face, no head, no torso, no identifiable portrait — hands and props only. The phone screen is unreadable. Calm, confident gesture. Natural realistic hands, no distortion.",
    videoMotionPrompt:
      "He gently reaches for the smartphone and taps once. Keep the screen blurred and unreadable. The motion should be slow, natural, and confident. Avoid hand artifacts.",
  },
  {
    index: 4,
    timeRange: "15–20s",
    title: "The product responds",
    filename: "04-product-responds.png",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    imagePrompt:
      "Clean premium product hero composition focused on the same modern living room window with the same motorized zebra blinds. Bright morning light enters through the blinds. Straight vertical window lines, clean zebra blind stripes, elegant modern window treatment, warm cinematic light, premium product photography feel. No people in frame.",
    videoMotionPrompt:
      "The motorized zebra blinds slowly and smoothly adjust after the phone tap. Harsh bands of sunlight gradually soften into a warm diffused glow. Keep the camera steady and elegant. Keep window lines straight and blind stripes clean.",
  },
  {
    index: 5,
    timeRange: "20–25s",
    title: "Independence noticed, not interrupted",
    filename: "05-independence-noticed.png",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    imagePrompt:
      "Same living room with softer diffused morning light. The elderly figure sits in the same armchair seen from behind, reading peacefully — no visible face. In the distant kitchen background, a family member appears only as a soft blurred silhouette with a small warm gesture; no clear faces anywhere in frame. Warm cinematic realism, restrained emotion, privacy-safe composition.",
    videoMotionPrompt:
      "The figure continues reading peacefully from behind. The distant silhouette gives a subtle warm gesture, then stillness. Comfort, dignity, independence — no identifiable faces on screen.",
  },
];

function buildStoryboardPrompt(seg: StoryboardSegment): string {
  return [
    `[Visual Bible] ${SHARED_VISUAL_BIBLE}`,
    `[Frame ${seg.index} — ${seg.title}] ${seg.imagePrompt}`,
    "[Output] One single still photograph, 9:16 vertical, premium cinematic realism, no text, no logo, no signage.",
  ].join("\n\n");
}

function buildSeedanceVideoPrompt(seg: StoryboardSegment): string {
  return [
    `[Visual Bible] ${SHARED_VISUAL_BIBLE}`,
    `[Shot ${seg.index} — ${seg.title}] ${seg.videoMotionPrompt}`,
    `[Constraints] ${SHARED_NEGATIVE_GUIDANCE}.`,
  ].join("\n\n");
}

// =============================================================
// Persistent state types
// =============================================================

interface StoryboardRecord {
  purpose: "sunny-shutter-investor-demo-v21-storyboards";
  ratio: typeof ASPECT_RATIO;
  source: "openai" | "manual";
  model?: string;
  size?: string;
  generatedAt?: string;
  segments: Array<{
    index: number;
    title: string;
    filename: string;
    /// Local absolute path under STORYBOARD_DIR
    localPath: string;
    /// Public Blob URL — required for Seedance I2V first_frame
    blobUrl?: string;
  }>;
}

interface SubmissionRecord {
  purpose: "sunny-shutter-investor-demo-v21-30s";
  ratio: typeof ASPECT_RATIO;
  segmentDurationSec: number;
  segments: Array<{
    index: number;
    title: string;
    timeRange: string;
    storyboardBlobUrl?: string;
    externalJobId?: string;
    submittedAt?: string;
    seedanceStatus?: "pending" | "processing" | "completed" | "failed";
    rawProviderStatus?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    errorMessage?: string;
  }>;
}

interface PipelineState {
  baseLocalSegments?: string[];
  watermarkedBaseLocal?: string;
  /// Optional logo-on-blinds composite stage (seg 4 only)
  blindsBrandedBaseLocal?: string;
  endCardLocal?: string;
  finalLocal?: string;
  finalBlobUrl?: string;
  posterLocal?: string;
  posterBlobUrl?: string;
  endCardBlobUrl?: string;
  publishedDeliveryOrderId?: string;
}

// =============================================================
// CLI parsing
// =============================================================

const ARGS = process.argv.slice(2);
function hasFlag(name: string): boolean {
  return ARGS.includes(`--${name}`);
}
function flagValue(name: string): string | undefined {
  for (const a of ARGS) {
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  const idx = ARGS.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < ARGS.length && !ARGS[idx + 1].startsWith("--")) {
    return ARGS[idx + 1];
  }
  return undefined;
}

const PHASE = (flagValue("phase") ?? "all") as
  | "all"
  | "storyboard"
  | "submit"
  | "wait"
  | "assemble"
  | "add-bgm"
  | "publish";

const DRY_RUN = hasFlag("dry-run");
const RESET_PUBLISH = hasFlag("reset-publish");
const AUTO_PUBLISH = hasFlag("auto-publish");
const REASSEMBLE = hasFlag("reassemble");
const REGENERATE_STORYBOARDS = hasFlag("regenerate-storyboards");
const LOGO_ON_BLINDS = hasFlag("logo-on-blinds");
const KEEP_AUDIO = hasFlag("keep-audio");
const SKIP_WARM_BGM = hasFlag("no-bgm");
/// Kevin MacLeod "Wholesome" (CC BY 4.0) — same warm acoustic bed as pet demo seed.
const WARM_BGM_SOURCE_URL =
  process.env.SUNNY_INVESTOR_BGM_URL ||
  "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/demo-seed/pet_store_chinese_demo_30s_no_text_bgm_v2.mp4";
const WARM_BGM_SOURCE_OFFSET_SEC = 4;

const STORYBOARD_SOURCE = (flagValue("storyboard-source") ?? "openai") as
  | "openai"
  | "manual";
const STORYBOARD_QUALITY = (flagValue("storyboard-quality") ?? "medium") as
  | "low"
  | "medium"
  | "high";

const RESUBMIT_SEGMENT_RAW = flagValue("resubmit-segment");
const RESUBMIT_SEGMENT = RESUBMIT_SEGMENT_RAW
  ? Number.parseInt(RESUBMIT_SEGMENT_RAW, 10)
  : null;
if (RESUBMIT_SEGMENT_RAW !== undefined) {
  if (
    !Number.isInteger(RESUBMIT_SEGMENT) ||
    RESUBMIT_SEGMENT! < 1 ||
    RESUBMIT_SEGMENT! > BASE_SEGMENT_COUNT
  ) {
    throw new Error(
      `--resubmit-segment must be an integer 1..${BASE_SEGMENT_COUNT}, got "${RESUBMIT_SEGMENT_RAW}"`,
    );
  }
}

// =============================================================
// Main entry
// =============================================================

const execFileAsync = promisify(execFile);
const db = new PrismaClient();

async function main() {
  banner("Sunny Shutter Investor Demo Pipeline (V2.1 — image storyboard I2V)");
  console.log(`storyboardDir   = ${STORYBOARD_DIR}`);
  console.log(`workDir         = ${WORK_DIR}`);
  console.log(`logo            = ${LOGO_PATH}`);
  console.log(
    `segments        = ${BASE_SEGMENT_COUNT} × ${BASE_SEGMENT_DURATION_SEC}s base + ${END_CARD_DURATION_SEC}s end card = ${TARGET_TOTAL_SEC}s`,
  );
  console.log(`phase           = ${PHASE}`);
  console.log(`dryRun          = ${DRY_RUN}`);
  console.log(`autoPublish     = ${AUTO_PUBLISH}`);
  console.log(`storyboardSource= ${STORYBOARD_SOURCE}`);
  console.log(
    `storyboardModel = ${STORYBOARD_MODEL} @ ${STORYBOARD_SIZE} (${STORYBOARD_QUALITY})`,
  );
  console.log(
    `resubmitSegment = ${RESUBMIT_SEGMENT ?? "(none — full plan)"}`,
  );
  console.log(`logoOnBlinds    = ${LOGO_ON_BLINDS}`);
  console.log(
    `audio           = ${KEEP_AUDIO ? "keep Seedance ambience" : SKIP_WARM_BGM ? "silent (no-bgm)" : "warm acoustic BGM bed (Kevin MacLeod Wholesome, -16 LUFS)"}`,
  );
  console.log(`reassemble      = ${REASSEMBLE}`);
  console.log(`regenSboards    = ${REGENERATE_STORYBOARDS}`);
  console.log(`personalUser    = ${DEMO_USER_EMAIL}`);

  preflight();
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(STORYBOARD_DIR, { recursive: true });

  if (REASSEMBLE) {
    /// Drop only the downstream artifacts; keep normalized per-segment files
    /// + Seedance submission so we don't re-charge.
    clearDownstreamArtifacts();
  }

  if (RESUBMIT_SEGMENT !== null) {
    clearSegmentForResubmit(RESUBMIT_SEGMENT);
  }

  if (PHASE === "all" || PHASE === "storyboard") {
    await phaseStoryboard();
    if (PHASE === "storyboard") {
      banner("Storyboard Review Gate");
      const storyboard = readStoryboard();
      if (storyboard) {
        for (const s of storyboard.segments) {
          console.log(
            `  ${String(s.index).padStart(2, "0")}. ${s.title}\n      local : ${s.localPath}\n      remote: ${s.blobUrl ?? "(not uploaded)"}`,
          );
        }
      }
      console.log(
        "\nReview the 5 PNGs by opening them. If approved, continue with:",
      );
      console.log(
        "  npx tsx scripts/sunny-shutter-investor-demo-v21.ts --phase=submit",
      );
      console.log(
        "If a frame needs a redo, replace the PNG manually and rerun storyboard --regenerate-storyboards (or rerun the storyboard phase).",
      );
      return;
    }
  }
  if (PHASE === "all" || PHASE === "submit") {
    await phaseSubmit();
  }
  if (PHASE === "all" || PHASE === "wait") {
    await phaseWait();
  }
  if (PHASE === "all" || PHASE === "assemble") {
    await phaseAssemble();
  }
  if (PHASE === "add-bgm") {
    await phaseAddBgm();
  }

  /// Publish gate — same shape as V1 design. PHASE=publish always runs.
  if (PHASE === "publish" || (PHASE === "all" && AUTO_PUBLISH)) {
    await phasePublish();
  } else if (PHASE === "all" && !AUTO_PUBLISH) {
    banner("Final Video Review Gate");
    const state = readState();
    console.log(
      "PHASE=all completed assemble but --auto-publish is not set; the demo was NOT pushed to /personal/videos.",
    );
    console.log("Review locally:");
    console.log(
      `  open ${state.finalLocal ?? path.join(WORK_DIR, "final.mp4")}`,
    );
    if (state.finalBlobUrl) {
      console.log(`  ${state.finalBlobUrl}`);
    }
    console.log("\nIf the cut is investor-ready, publish with:");
    console.log(
      "  npx tsx scripts/sunny-shutter-investor-demo-v21.ts --phase=publish",
    );
    console.log("If a single shot is weak, rerun just that one with:");
    console.log(
      "  npx tsx scripts/sunny-shutter-investor-demo-v21.ts --resubmit-segment=N --reassemble",
    );
  }

  banner("Done");
  const state = readState();
  console.log("finalBlobUrl  =", state.finalBlobUrl ?? "(not produced)");
  console.log("posterBlobUrl =", state.posterBlobUrl ?? "(not produced)");
  console.log(
    "deliveryOrder =",
    state.publishedDeliveryOrderId ?? "(held for human review)",
  );
  if (state.publishedDeliveryOrderId) {
    console.log(
      `Sign in at /login as ${DEMO_USER_EMAIL} to view it on /personal/videos.`,
    );
  }
}

// =============================================================
// Preflight
// =============================================================

function preflight() {
  banner("Preflight");
  const missing: string[] = [];
  if (!process.env.BYTEPLUS_ARK_API_KEY && !DRY_RUN) missing.push("BYTEPLUS_ARK_API_KEY");
  if (!process.env.BLOB_READ_WRITE_TOKEN && !DRY_RUN) {
    missing.push("BLOB_READ_WRITE_TOKEN");
  }
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (
    !process.env.OPENAI_API_KEY &&
    !DRY_RUN &&
    STORYBOARD_SOURCE === "openai" &&
    (PHASE === "all" || PHASE === "storyboard")
  ) {
    missing.push("OPENAI_API_KEY");
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Configure in .env.local.`,
    );
  }
  if (
    process.env.VIDEO_ENGINE_MOCK?.toLowerCase() === "true" ||
    process.env.VIDEO_ENGINE_MOCK === "1"
  ) {
    throw new Error(
      "VIDEO_ENGINE_MOCK=true detected. This investor demo must use real Seedance. Unset the flag and re-run.",
    );
  }
  if (
    process.env.IMAGE_ENGINE_MOCK?.toLowerCase() === "true" &&
    STORYBOARD_SOURCE === "openai" &&
    !DRY_RUN &&
    (PHASE === "all" || PHASE === "storyboard")
  ) {
    throw new Error(
      "IMAGE_ENGINE_MOCK=true detected — storyboards would be mock placeholders. Unset to use real gpt-image-2.",
    );
  }
  if (!existsSync(LOGO_PATH) || statSync(LOGO_PATH).size === 0) {
    throw new Error(
      `Sunny logo not found at ${LOGO_PATH}. Drop the real logo PNG there and re-run.`,
    );
  }
  if (
    !DRY_RUN &&
    (PHASE === "all" || PHASE === "submit" || PHASE === "wait")
  ) {
    assertSeedanceReachable();
  }
  console.log("preflight = ok");
}

/** Fail fast when the BytePlus international Ark endpoint is unreachable. */
function assertSeedanceReachable() {
  const base =
    process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3";
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    throw new Error(`ARK_BASE_URL is not a valid URL: ${base}`);
  }
  let httpCode = "000";
  try {
    httpCode = execFileSync(
      "curl",
      [
        "-4",
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "--connect-timeout",
        "10",
        "--max-time",
        "15",
        origin,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    /* curl exit non-zero — treat as unreachable */
  }
  if (httpCode === "000") {
    throw new Error(
      [
        `无法连接 Seedance API（${origin}，HTTP ${httpCode}）。`,
        "确认当前网络可访问 BytePlus 国际区后重试：npm run demo:sunny-investor:v21:resume",
        "请在 .env.local 配置国际区 BYTEPLUS_ARK_API_KEY + ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3。",
      ].join("\n"),
    );
  }
  console.log(`seedanceReachable = ${origin} (HTTP ${httpCode})`);
}

// =============================================================
// Phase 1 — Storyboard (gpt-image-2 or manual)
// =============================================================

async function phaseStoryboard() {
  banner("Phase 1 — Storyboard frames (9:16 keyframes)");

  const existing = readStoryboard();

  /// Prompt validation — always show prompt sizes so we don't quietly send
  /// truncated prompts to gpt-image-2.
  for (const seg of STORYBOARD_PLAN) {
    const prompt = buildStoryboardPrompt(seg);
    console.log(
      `  segment ${seg.index} "${seg.title}" — promptChars=${prompt.length} → ${seg.filename}`,
    );
  }

  const record: StoryboardRecord = existing ?? {
    purpose: "sunny-shutter-investor-demo-v21-storyboards",
    ratio: ASPECT_RATIO,
    source: STORYBOARD_SOURCE,
    model: STORYBOARD_SOURCE === "openai" ? STORYBOARD_MODEL : undefined,
    size: STORYBOARD_SOURCE === "openai" ? STORYBOARD_SIZE : undefined,
    segments: STORYBOARD_PLAN.map((s) => ({
      index: s.index,
      title: s.title,
      filename: s.filename,
      localPath: path.join(STORYBOARD_DIR, s.filename),
    })),
  };

  /// Update source/model fields on every run to reflect current invocation
  /// (so a switch from manual → openai doesn't keep stale metadata)
  record.source = STORYBOARD_SOURCE;
  if (STORYBOARD_SOURCE === "openai") {
    record.model = STORYBOARD_MODEL;
    record.size = STORYBOARD_SIZE;
  }

  if (STORYBOARD_SOURCE === "manual") {
    /// Manual mode: just check the 5 PNGs exist + upload to Blob.
    let missing = 0;
    for (const seg of record.segments) {
      if (!existsSync(seg.localPath) || statSync(seg.localPath).size === 0) {
        console.log(
          `  segment ${seg.index} ${seg.title}: MISSING — drop a 9:16 PNG at ${seg.localPath}`,
        );
        missing++;
      } else {
        console.log(
          `  segment ${seg.index} ${seg.title}: present (${(statSync(seg.localPath).size / 1024).toFixed(0)} KB)`,
        );
      }
    }
    if (missing > 0) {
      throw new Error(
        `${missing}/${BASE_SEGMENT_COUNT} storyboard PNGs missing. Place them under ${STORYBOARD_DIR} (filenames listed above) and re-run --phase=storyboard.`,
      );
    }
  } else {
    /// OpenAI mode: generate via gpt-image-2 unless cached + not regenerating.
    for (const seg of record.segments) {
      const cached =
        existsSync(seg.localPath) &&
        statSync(seg.localPath).size > 0 &&
        !!seg.blobUrl;
      if (cached && !REGENERATE_STORYBOARDS) {
        console.log(
          `  segment ${seg.index} ${seg.title}: cached (${seg.localPath} + ${shorten(seg.blobUrl!, 60)})`,
        );
        continue;
      }
      const planSeg = STORYBOARD_PLAN.find((p) => p.index === seg.index)!;
      const prompt = buildStoryboardPrompt(planSeg);
      if (DRY_RUN) {
        console.log(
          `  segment ${seg.index} [DRY RUN]: would call ${STORYBOARD_MODEL} @ ${STORYBOARD_SIZE} — promptChars=${prompt.length}`,
        );
        continue;
      }
      console.log(
        `  segment ${seg.index} ${seg.title}: calling ${STORYBOARD_MODEL} @ ${STORYBOARD_SIZE} quality=${STORYBOARD_QUALITY}`,
      );
      /// generateImages handles the b64_json → Blob upload path internally
      /// when blobPrefix is provided; we pin n=1 since we want a single,
      /// directed frame per shot. quality is forwarded as part of args
      /// (gpt-image-2 supports low/medium/high).
      const result = await generateImages({
        prompt,
        n: 1,
        size: STORYBOARD_SIZE,
        quality: STORYBOARD_QUALITY,
        model: STORYBOARD_MODEL,
        blobPrefix: `personal-demos/sunny-shutter-storyboards-v21/${seg.index}-`,
      });
      if (result.fromMock) {
        throw new Error(
          `gpt-image-2 returned mock URLs (forceMock or env IMAGE_ENGINE_MOCK active). Unset and retry.`,
        );
      }
      const blobUrl = result.urls[0];
      if (!blobUrl) {
        throw new Error(
          `Storyboard frame ${seg.index} returned no URL. Check OpenAI quota / model availability.`,
        );
      }
      /// Mirror the Blob copy locally for human review under STORYBOARD_DIR.
      await downloadHttpToFile(blobUrl, seg.localPath);
      seg.blobUrl = blobUrl;
      record.generatedAt = new Date().toISOString();
      writeStoryboard(record);
      console.log(`    → local : ${seg.localPath}`);
      console.log(`    → remote: ${shorten(blobUrl, 70)}`);
    }
  }

  /// Manual-mode upload step (so submit phase always has a Blob URL to feed
  /// to Seedance I2V regardless of source)
  if (STORYBOARD_SOURCE === "manual" && !DRY_RUN) {
    for (const seg of record.segments) {
      if (seg.blobUrl) {
        console.log(
          `  segment ${seg.index}: already uploaded (${shorten(seg.blobUrl, 60)})`,
        );
        continue;
      }
      console.log(`  segment ${seg.index}: uploading manual PNG to Blob`);
      const blobPath = `personal-demos/sunny-shutter-storyboards-v21/${seg.index}-${seg.filename}`;
      seg.blobUrl = await uploadToBlob(seg.localPath, blobPath, "image/png");
      writeStoryboard(record);
    }
  }

  writeStoryboard(record);
  console.log(`storyboard.json = ${STORYBOARD_PATH}`);
}

// =============================================================
// Phase 2 — Submit Seedance I2V (first_frame = storyboard Blob URL)
// =============================================================

async function phaseSubmit() {
  banner("Phase 2 — Submit Seedance I2V segments");

  const storyboard = readStoryboard();
  if (!storyboard) {
    if (DRY_RUN) {
      console.log("dryRun: no storyboard.json yet, skipping submit phase");
      return;
    }
    throw new Error(
      "storyboard.json missing — run --phase=storyboard first (or --storyboard-source=manual after placing PNGs).",
    );
  }

  /// I2V segments need Blob URLs; T2V-only segments (2/3/5) can omit them.
  for (const s of storyboard.segments) {
    if (!s.blobUrl && !T2V_ONLY_SEGMENT_INDICES.has(s.index)) {
      throw new Error(
        `Storyboard segment ${s.index} has no Blob URL. Re-run --phase=storyboard.`,
      );
    }
  }

  const existing = readSubmission();
  if (existing) {
    const allSubmitted = existing.segments.every((s) => !!s.externalJobId);
    if (allSubmitted) {
      console.log(
        `Found existing submission.json with ${existing.segments.length}/${BASE_SEGMENT_COUNT} jobs already submitted — skipping submit phase to avoid double-charging.`,
      );
      for (const s of existing.segments) {
        console.log(
          `  segment ${s.index}: externalJobId=${s.externalJobId} title="${s.title}"`,
        );
      }
      return;
    }
  }

  const record: SubmissionRecord = existing ?? {
    purpose: "sunny-shutter-investor-demo-v21-30s",
    ratio: ASPECT_RATIO,
    segmentDurationSec: BASE_SEGMENT_DURATION_SEC,
    segments: STORYBOARD_PLAN.map((s) => ({
      index: s.index,
      title: s.title,
      timeRange: s.timeRange,
    })),
  };

  for (const plan of STORYBOARD_PLAN) {
    const slot = record.segments.find((s) => s.index === plan.index);
    if (!slot) continue;
    if (slot.externalJobId) {
      console.log(
        `  segment ${plan.index}: already submitted (externalJobId=${slot.externalJobId}), skipping`,
      );
      continue;
    }

    const sboard = storyboard.segments.find((s) => s.index === plan.index);
    const useI2v =
      !T2V_ONLY_SEGMENT_INDICES.has(plan.index) && !!sboard?.blobUrl;
    if (!useI2v && !T2V_ONLY_SEGMENT_INDICES.has(plan.index)) {
      throw new Error(
        `Storyboard Blob URL for segment ${plan.index} is missing — re-run --phase=storyboard.`,
      );
    }

    const fullPrompt = buildSeedanceVideoPrompt(plan);
    if (sboard?.blobUrl) slot.storyboardBlobUrl = sboard.blobUrl;

    if (DRY_RUN) {
      console.log(
        `  segment ${plan.index} [DRY RUN]: would submit ${useI2v ? "I2V" : "T2V"} ${plan.durationSec}s @ 9:16 — promptChars=${fullPrompt.length}${useI2v ? ` firstFrame=${shorten(sboard!.blobUrl!, 60)}` : ""} generate_audio=${KEEP_AUDIO}`,
      );
      continue;
    }

    const submitOpts = {
      prompt: fullPrompt,
      duration: plan.durationSec,
      ratio: ASPECT_RATIO,
      referenceImageUrls: useI2v ? [sboard!.blobUrl!] : undefined,
      generateAudio: KEEP_AUDIO ? true : false,
    };

    let submission: { jobId: string };
    try {
      submission = await submitSeedanceJob(submitOpts);
    } catch (err) {
      const msg = (err as Error).message;
      if (
        useI2v &&
        /SensitiveContent|real person|PrivacyInformation/i.test(msg)
      ) {
        console.warn(
          `  segment ${plan.index}: I2V blocked (privacy) — retrying as T2V without first_frame`,
        );
        submission = await submitSeedanceJob({
          ...submitOpts,
          referenceImageUrls: undefined,
        });
      } else {
        throw err;
      }
    }

    slot.externalJobId = submission.jobId;
    slot.submittedAt = new Date().toISOString();
    writeSubmission(record);
    console.log(
      `  segment ${plan.index} submitted: externalJobId=${submission.jobId} mode=${useI2v ? "I2V" : "T2V"}${useI2v ? ` firstFrame=${shorten(sboard!.blobUrl!, 60)}` : ""}`,
    );
  }
}

// =============================================================
// Phase 3 — Wait for Seedance completion
// =============================================================

async function phaseWait() {
  banner("Phase 3 — Wait for Seedance to finish");
  const record = readSubmission();
  if (!record) {
    if (DRY_RUN) {
      console.log("dryRun: no submission.json yet, skipping wait phase");
      return;
    }
    throw new Error("submission.json missing — run --phase=submit first");
  }

  const POLL_INTERVAL_MS = 15_000;
  const MAX_WAIT_MS = 30 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    let pending = 0;
    let failed = 0;
    for (const segment of record.segments) {
      if (!segment.externalJobId) {
        if (DRY_RUN) continue;
        throw new Error(
          `segment ${segment.index} has no externalJobId; re-run --phase=submit`,
        );
      }
      if (segment.seedanceStatus === "completed" && segment.videoUrl) {
        continue;
      }
      const status = await getSeedanceStatus(segment.externalJobId);
      segment.seedanceStatus = status.status;
      segment.rawProviderStatus = status.rawProviderStatus;
      segment.videoUrl = status.videoUrl;
      segment.thumbnailUrl = status.thumbnailUrl;
      segment.errorMessage = status.errorMessage;

      console.log(
        `  segment ${segment.index} ${segment.timeRange} ${segment.title}: ${status.status} (${status.rawProviderStatus})${
          status.videoUrl ? ` videoUrl=${shorten(status.videoUrl, 60)}` : ""
        }`,
      );
      if (status.status === "failed") failed++;
      else if (status.status !== "completed") pending++;
    }
    writeSubmission(record);

    if (failed > 0) {
      throw new Error(
        `${failed} Seedance segments failed. Inspect ${SUBMISSION_PATH} and decide whether to re-submit (use --resubmit-segment=N).`,
      );
    }
    if (pending === 0) {
      console.log("All segments completed.");
      return;
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error(
        `Timed out after ${Math.round(MAX_WAIT_MS / 60_000)} minutes. Re-run later (state is persisted).`,
      );
    }
    console.log(
      `  waiting ${pending} more segment(s)... next poll in ${POLL_INTERVAL_MS / 1000}s`,
    );
    if (DRY_RUN) return;
    await sleep(POLL_INTERVAL_MS);
  }
}

// =============================================================
// Phase 4 — Assemble (download → normalize → concat → watermark → end card)
// =============================================================

async function phaseAssemble() {
  banner("Phase 4 — Assemble final video");
  if (DRY_RUN) {
    console.log("dryRun: skipping assemble phase");
    return;
  }

  await ensureFfmpeg();

  const record = readSubmission();
  if (!record) throw new Error("submission.json missing");
  const segments = record.segments
    .filter((s) => s.videoUrl)
    .sort((a, b) => a.index - b.index);
  if (segments.length !== BASE_SEGMENT_COUNT) {
    throw new Error(
      `Expected ${BASE_SEGMENT_COUNT} completed segments with videoUrl, found ${segments.length}. Run --phase=wait first.`,
    );
  }

  const state = readState();

  /// 4.1 Download + normalize each segment to 720x1280@30fps with consistent
  ///     audio handling (default: silent stereo so 5 segments concat cleanly).
  const normalizedDir = path.join(WORK_DIR, "normalized");
  mkdirSync(normalizedDir, { recursive: true });
  const normalized: string[] = [];
  for (const s of segments) {
    const out = path.join(normalizedDir, `seg-${s.index}.mp4`);
    if (existsSync(out) && statSync(out).size > 0) {
      console.log(`  segment ${s.index}: cached normalized file ${out}`);
      normalized.push(out);
      continue;
    }
    const localInput = path.join(WORK_DIR, `raw-seg-${s.index}.mp4`);
    if (!existsSync(localInput) || statSync(localInput).size === 0) {
      console.log(`  segment ${s.index}: downloading ${shorten(s.videoUrl!, 60)}`);
      await downloadHttpToFile(s.videoUrl!, localInput);
    }
    console.log(
      `  segment ${s.index}: normalizing → ${out} (audio=${KEEP_AUDIO ? "keep" : "silent"})`,
    );
    await normalizeOneSegment(localInput, out, KEEP_AUDIO);
    normalized.push(out);
  }
  state.baseLocalSegments = normalized;
  writeState(state);

  /// 4.2 Concatenate normalized segments → base.mp4 (~25s)
  const baseLocal = path.join(WORK_DIR, "base.mp4");
  if (!existsSync(baseLocal) || statSync(baseLocal).size === 0) {
    console.log("  concatenating segments → base.mp4");
    await concatNormalized(normalized, baseLocal);
  } else {
    console.log("  base.mp4: cached");
  }

  /// 4.3 Apply top-right Sunny watermark via Brand Overlay Layer.
  let watermarked = state.watermarkedBaseLocal;
  if (!watermarked || !existsSync(watermarked)) {
    console.log(
      "  applying brand overlay watermark (top-left, opacity 0.84, ~15% width)",
    );
    const overlay = await applyBrandOverlay({
      sourceVideo: baseLocal,
      logo: LOGO_PATH,
      placement: "top-left",
      opacity: 0.84,
      logoWidthRatio: 0.15,
      marginPx: 32,
      durationMode: "full_video",
      outputDir: path.join(WORK_DIR, "overlay-out"),
    });
    watermarked = overlay.outputPath;
    console.log(`  watermark applied: ${watermarked}`);
    console.log(`  overlay filter: ${overlay.filterGraph}`);
  } else {
    console.log(`  watermarked base: cached at ${watermarked}`);
  }
  state.watermarkedBaseLocal = watermarked;
  writeState(state);

  /// 4.4 (Optional, opt-in) subtle logo-on-blinds for segment 4 only.
  ///     This is a single in-script ffmpeg overlay window: t=16..18.5 (the
  ///     stable middle of segment 4). Bottom-right of frame, very small,
  ///     low opacity. If --no flag, this stage is skipped entirely.
  if (LOGO_ON_BLINDS) {
    let blindsBranded = state.blindsBrandedBaseLocal;
    if (!blindsBranded || !existsSync(blindsBranded)) {
      console.log(
        "  applying optional logo-on-blinds overlay (segment 4, t=16..18.5, bottom-right, opacity 0.5, ~8% width)",
      );
      const out = path.join(WORK_DIR, "watermarked-with-blinds-mark.mp4");
      await applyLogoOnBlindsWindow(watermarked, LOGO_PATH, out);
      blindsBranded = out;
    } else {
      console.log(`  logo-on-blinds: cached at ${blindsBranded}`);
    }
    state.blindsBrandedBaseLocal = blindsBranded;
    /// Promote this as the watermark stage's output for downstream concat
    watermarked = blindsBranded;
    writeState(state);
  } else {
    console.log("  logo-on-blinds: skipped (use --logo-on-blinds to enable)");
  }

  /// 4.5 Render Brand End Card (real logo composited; hideCta=true → premium minimal).
  let endCardLocal = state.endCardLocal;
  if (!endCardLocal || !existsSync(endCardLocal)) {
    console.log(
      "  rendering brand end card (5s, real logo composited, hideCta=true)",
    );
    const plan: BrandPackagingPlan = {
      mode: "auto_end_card",
      logoAssetId: null,
      endCardDurationSeconds: END_CARD_DURATION_SEC,
      cta: null,
      hideCta: true,
      brandName: BRAND_NAME,
      slogan: BRAND_SLOGAN,
      website: BRAND_WEBSITE,
      renderStrategy: "render_ffmpeg_overlay",
      warnings: [],
    };
    /// Force local end-card render. In production deploys the renderer may
    /// defer to an external worker; here we always render in-process for
    /// determinism + offline reproducibility.
    process.env.STITCH_RUNTIME = "local";
    const result = await renderBrandEndCard({
      briefId: "sunny-shutter-investor-demo-v21",
      aspectRatio: ASPECT_RATIO,
      plan,
      logoUrl: pathToFileURL(LOGO_PATH).toString(),
    });
    if (!result || !result.url) {
      throw new Error(
        `End card not produced (source=${result?.source ?? "null"}). ${result?.warnings.join(" | ") ?? ""}`,
      );
    }
    endCardLocal = await materializeUrl(
      result.url,
      path.join(WORK_DIR, "endcard.mp4"),
    );
    console.log(`  end card: ${endCardLocal}`);
    if (result.warnings.length > 0) {
      console.log(`  end card warnings: ${result.warnings.join(" | ")}`);
    }
  } else {
    console.log(`  end card: cached at ${endCardLocal}`);
  }
  state.endCardLocal = endCardLocal;
  writeState(state);

  /// 4.6 Concatenate watermarked base + end card → final.mp4
  const finalLocal = path.join(WORK_DIR, "final.mp4");
  if (!existsSync(finalLocal) || statSync(finalLocal).size === 0) {
    console.log("  concatenating watermarked base + end card → final.mp4");
    const stagingDir = path.join(WORK_DIR, "stage");
    mkdirSync(stagingDir, { recursive: true });
    const stage1 = path.join(stagingDir, "wm-base.mp4");
    const stage2 = path.join(stagingDir, "endcard-norm.mp4");
    /// re-normalize both stages so concat demuxer sees identical streams.
    /// Audio handling matches the user's KEEP_AUDIO choice.
    await normalizeOneSegment(watermarked, stage1, KEEP_AUDIO);
    await normalizeOneSegment(endCardLocal, stage2, KEEP_AUDIO);
    await concatNormalized([stage1, stage2], finalLocal);
  } else {
    console.log("  final.mp4: cached");
  }
  state.finalLocal = finalLocal;
  writeState(state);

  /// 4.6b Warm acoustic BGM (default when Seedance audio is stripped).
  if (!KEEP_AUDIO && !SKIP_WARM_BGM) {
    console.log(
      "  muxing warm acoustic BGM (Wholesome / CC BY 4.0, trimmed + faded + loudnorm -16 LUFS)",
    );
    await applyWarmInvestorBgm(finalLocal);
  } else if (!KEEP_AUDIO && SKIP_WARM_BGM) {
    console.log("  warm BGM: skipped (--no-bgm)");
  }

  /// 4.7 Generate poster (first-frame JPG)
  const posterLocal = path.join(WORK_DIR, "poster.jpg");
  if (!existsSync(posterLocal) || statSync(posterLocal).size === 0) {
    console.log("  extracting poster frame → poster.jpg");
    await extractPoster(finalLocal, posterLocal);
  } else {
    console.log("  poster.jpg: cached");
  }
  state.posterLocal = posterLocal;
  writeState(state);

  /// 4.8 Upload final + poster to Vercel Blob (idempotent: overwrite=true)
  if (!state.finalBlobUrl) {
    console.log("  uploading final.mp4 to Vercel Blob");
    state.finalBlobUrl = await uploadToBlob(
      finalLocal,
      `personal-demos/sunny-shutter-investor-demo-v21-${nowStamp()}.mp4`,
      "video/mp4",
    );
    writeState(state);
  }
  if (!state.posterBlobUrl) {
    console.log("  uploading poster.jpg to Vercel Blob");
    state.posterBlobUrl = await uploadToBlob(
      posterLocal,
      `personal-demos/sunny-shutter-investor-demo-v21-${nowStamp()}-poster.jpg`,
      "image/jpeg",
    );
    writeState(state);
  }
  console.log(`  finalBlobUrl  = ${state.finalBlobUrl}`);
  console.log(`  posterBlobUrl = ${state.posterBlobUrl}`);
}

// =============================================================
// Phase 4b — Add warm BGM to an existing final.mp4
// =============================================================

async function phaseAddBgm() {
  banner("Phase 4b — Warm acoustic BGM");
  await ensureFfmpeg();
  const finalLocal = path.join(WORK_DIR, "final.mp4");
  if (!existsSync(finalLocal) || statSync(finalLocal).size === 0) {
    throw new Error(`final.mp4 missing at ${finalLocal} — run --phase=assemble first`);
  }
  await applyWarmInvestorBgm(finalLocal);
  const state = readState();
  state.finalLocal = finalLocal;
  delete state.finalBlobUrl;
  writeState(state);
  console.log("  uploading final.mp4 to Vercel Blob");
  state.finalBlobUrl = await uploadToBlob(
    finalLocal,
    `personal-demos/sunny-shutter-investor-demo-v21-${nowStamp()}.mp4`,
    "video/mp4",
  );
  writeState(state);
  console.log(`  finalBlobUrl = ${state.finalBlobUrl}`);
}

// =============================================================
// Phase 5 — Publish to /personal/videos
// =============================================================

async function phasePublish() {
  banner("Phase 5 — Publish to /personal/videos");
  const state = readState();
  const submission = readSubmission();
  if (!state.finalBlobUrl || !state.posterBlobUrl) {
    if (DRY_RUN) {
      console.log("dryRun: no Blob URLs yet, skipping publish phase");
      return;
    }
    throw new Error(
      "finalBlobUrl / posterBlobUrl missing in state.json — run --phase=assemble first",
    );
  }
  if (!submission) throw new Error("submission.json missing");

  /// 5.1 Upsert PERSONAL demo user (same email as V1 — single demo entry per
  ///     /personal/videos library)
  const passwordHash = await bcrypt.hash(DEMO_USER_DEFAULT_PASSWORD, 10);
  const personal = await db.adminUser.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: {
      email: DEMO_USER_EMAIL,
      name: DEMO_USER_NAME,
      hashedPassword: passwordHash,
      userType: "PERSONAL",
      role: "OPERATOR",
    },
    update: { userType: "PERSONAL", name: DEMO_USER_NAME },
  });
  console.log(
    `  PERSONAL user: id=${personal.id} email=${personal.email} userType=${personal.userType}`,
  );
  console.log(
    `  (NOTE) sign-in password = "${DEMO_USER_DEFAULT_PASSWORD}" — record it now if this is the first run.`,
  );

  /// 5.2 Optional reset: drop any prior demo entry for this user (by exact title)
  if (RESET_PUBLISH) {
    const stale = await db.deliveryOrder.findMany({
      where: { createdById: personal.id, title: ORDER_TITLE },
      select: { id: true },
    });
    for (const o of stale) {
      console.log(`  --reset-publish: cascading delete of prior order ${o.id}`);
      await db.deliveryOrder.delete({ where: { id: o.id } });
    }
  }

  /// 5.3 Reuse existing demo order if one already exists; otherwise create
  ///     the full graph in a transaction.
  const existingOrder = await db.deliveryOrder.findFirst({
    where: {
      createdById: personal.id,
      title: ORDER_TITLE,
      productCategory: "unified_input",
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingOrder) {
    console.log(
      `  reusing existing order ${existingOrder.id} (use --reset-publish to recreate)`,
    );
    state.publishedDeliveryOrderId = existingOrder.id;
    writeState(state);
    await refreshExistingDemo(existingOrder.id, state, submission);
    return;
  }

  const created = await db.$transaction(async (tx) => {
    const order = await tx.deliveryOrder.create({
      data: {
        title: ORDER_TITLE,
        productCategory: "unified_input",
        targetCountry: "CA",
        targetLanguage: "en",
        targetRegionVariant: "en-CA",
        productInput: {
          source: "investor_demo_v21",
          description: ORDER_DESCRIPTION,
          brandKit: {
            brandName: BRAND_NAME,
            slogan: BRAND_SLOGAN,
            website: BRAND_WEBSITE,
            logoUrl: pathToFileURL(LOGO_PATH).toString(),
          },
        },
        createdById: personal.id,
      },
    });

    const round = await tx.round.create({
      data: {
        deliveryOrderId: order.id,
        roundIndex: 1,
        status: "LIVE",
      },
    });

    const angle = await tx.contentAngle.create({
      data: {
        roundId: round.id,
        sortOrder: 0,
        type: "OPTIMIZATION",
        title: "Comfort, with independence.",
        hook: "He does not need the room changed for him. He changes it himself.",
        narrative:
          "An elderly man taps once on a phone; the motorized blinds soften the morning light, and a family member smiles from the kitchen. Calm, premium, restrained.",
      },
    });

    const finalVideo = await tx.finalVideo.create({
      data: {
        targetDurationSec: TARGET_TOTAL_SEC,
        segmentCount: BASE_SEGMENT_COUNT,
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: state.finalBlobUrl!,
        thumbnailUrl: state.posterBlobUrl!,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    const brief = await tx.videoBrief.create({
      data: {
        contentAngleId: angle.id,
        status: VideoBriefStatus.QA_APPROVED,
        durationSec: TARGET_TOTAL_SEC,
        aspectRatio: ASPECT_RATIO,
        targetDurationSec: TARGET_TOTAL_SEC,
        persona: "PERSONAL",
        finalVideoUrl: state.finalBlobUrl!,
        finalThumbnailUrl: state.posterBlobUrl!,
        finalVideoId: finalVideo.id,
      },
    });

    /// 5 SUCCEEDED VideoJobs so the scene-progress UI reads 5/5.
    /// Provider = SEEDANCE_I2V because V2.1 used image-to-video.
    for (const segment of submission.segments) {
      await tx.videoJob.create({
        data: {
          videoBriefId: brief.id,
          provider: VideoProvider.SEEDANCE_I2V,
          externalJobId: segment.externalJobId,
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: segment.videoUrl,
          outputThumbUrl: segment.thumbnailUrl ?? state.posterBlobUrl!,
          segmentIndex: segment.index - 1,
          segmentDurationSec: BASE_SEGMENT_DURATION_SEC,
          finalVideoId: finalVideo.id,
          submittedAt: new Date(),
          startedAt: new Date(),
          finishedAt: new Date(),
          lastCheckedAt: new Date(),
          lastProviderStatus: "succeeded",
        },
      });
    }

    return { order, brief, finalVideo };
  });

  console.log(`  created deliveryOrder ${created.order.id}`);
  console.log(
    `  created videoBrief    ${created.brief.id} (persona=PERSONAL, status=QA_APPROVED)`,
  );
  console.log(
    `  created finalVideo    ${created.finalVideo.id} (status=READY)`,
  );
  state.publishedDeliveryOrderId = created.order.id;
  writeState(state);
}

async function refreshExistingDemo(
  orderId: string,
  state: PipelineState,
  submission: SubmissionRecord,
) {
  const order = await db.deliveryOrder.findUnique({
    where: { id: orderId },
    include: {
      rounds: {
        include: {
          angles: {
            include: { videoBrief: { include: { finalVideo: true, videoJobs: true } } },
          },
        },
      },
    },
  });
  if (!order) return;
  const brief = order.rounds[0]?.angles[0]?.videoBrief;
  if (!brief) return;

  if (brief.finalVideoId) {
    await db.finalVideo.update({
      where: { id: brief.finalVideoId },
      data: {
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: state.finalBlobUrl!,
        thumbnailUrl: state.posterBlobUrl!,
        finishedAt: new Date(),
      },
    });
  }
  await db.videoBrief.update({
    where: { id: brief.id },
    data: {
      status: VideoBriefStatus.QA_APPROVED,
      finalVideoUrl: state.finalBlobUrl!,
      finalThumbnailUrl: state.posterBlobUrl!,
    },
  });
  for (const seg of submission.segments) {
    const job = brief.videoJobs.find((j) => j.segmentIndex === seg.index - 1);
    if (!job) continue;
    await db.videoJob.update({
      where: { id: job.id },
      data: {
        provider: VideoProvider.SEEDANCE_I2V, /// V2.1 upgrade marker
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: seg.videoUrl,
        externalJobId: seg.externalJobId ?? job.externalJobId,
        finishedAt: new Date(),
        lastCheckedAt: new Date(),
        lastProviderStatus: "succeeded",
      },
    });
  }
  console.log("  refreshed existing demo entry with new final URL + poster.");
}

// =============================================================
// FFmpeg helpers
// =============================================================

async function ensureFfmpeg() {
  try {
    await execFileAsync(FFMPEG_BIN, ["-version"], { timeout: 5_000 });
    await execFileAsync(FFPROBE_BIN, ["-version"], { timeout: 5_000 });
  } catch (err) {
    throw new Error(
      `ffmpeg/ffprobe not available (FFMPEG_BIN=${FFMPEG_BIN}). Install ffmpeg or set FFMPEG_BIN. Error: ${(err as Error).message}`,
    );
  }
}

/**
 * Normalize one segment to 720x1280@30fps.
 * - keepAudio=false (default V2.1): audio replaced with anullsrc silent
 *   stereo so the 5-clip concat stays artifact-free even when Seedance
 *   returned silent / inconsistent ambience.
 * - keepAudio=true: amerge with original audio (matches V1 behavior).
 */
async function normalizeOneSegment(
  input: string,
  output: string,
  keepAudio: boolean,
) {
  const filterChain = keepAudio
    ? `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v];[0:a?][1:a]amerge=inputs=2,pan=stereo|c0=c0|c1=c1[a]`
    : `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v]`;
  /// keepAudio=true → use the amerged [a] label produced by filterChain.
  /// keepAudio=false → ignore source audio entirely; map the silent
  /// anullsrc input (-i index 1) directly so concat sees a uniform stereo
  /// AAC track on every segment.
  const audioMap = keepAudio ? "[a]" : "1:a";
  const args = [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex",
    filterChain,
    "-map",
    "[v]",
    "-map",
    audioMap,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-shortest",
    output,
  ];
  await execFileAsync(FFMPEG_BIN, args, {
    timeout: 90_000,
    maxBuffer: 1024 * 1024 * 50,
  });
}

async function concatNormalized(inputs: string[], output: string) {
  const listPath = path.join(path.dirname(output), `concat-${Date.now()}.txt`);
  const lines = inputs.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n");
  await writeFile(listPath, lines, "utf8");
  try {
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 90_000, maxBuffer: 1024 * 1024 * 50 },
    );
  } finally {
    await rm(listPath, { force: true });
  }
}

async function extractPoster(input: string, output: string) {
  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vframes",
      "1",
      "-q:v",
      "3",
      output,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 * 16 },
  );
}

/**
 * Apply a small, low-opacity Sunny logo overlay on the bottom-right of the
 * frame ONLY between t=16 and t=18.5 (the stable middle of segment 4 — the
 * blinds product hero shot). This is a one-off ffmpeg overlay window; the
 * Brand Overlay Layer (`brand-overlay-renderer.ts`) handles full-video
 * watermark cases, this handles the V2.1-specific moment of "the brand mark
 * touches the product hero, briefly, tastefully".
 */
async function applyLogoOnBlindsWindow(
  input: string,
  logo: string,
  output: string,
) {
  /// Timing math: segment 1..4 are each 5s normalized → seg 4 spans t=15..20.
  /// We anchor the brand mark at t=16..18.5 so it appears *after* the blinds
  /// have started moving and disappears before the cut to seg 5.
  /// Logo: ~8% of frame width = 720 * 0.08 ≈ 58px wide, 0.55 opacity.
  /// Position: bottom-right, 48px right margin, 72px bottom margin
  /// (above the watermark zone).
  const logoW = Math.max(1, Math.round(TARGET_WIDTH * 0.08));
  const filter =
    `[1:v]format=rgba,colorchannelmixer=aa=0.550,scale=${logoW}:-1[mark];` +
    `[0:v][mark]overlay=main_w-overlay_w-48:main_h-overlay_h-72:enable='between(t,16,18.5)'[v]`;
  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      input,
      "-i",
      logo,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "medium",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 * 50 },
  );
}

// =============================================================
// I/O helpers
// =============================================================

async function downloadHttpToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `download failed (${res.status} ${res.statusText}) for ${shorten(url, 80)}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function materializeUrl(url: string, dest: string): Promise<string> {
  if (url.startsWith("file://")) {
    copyFileSync(fileURLToPath(url), dest);
    return dest;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    await downloadHttpToFile(url, dest);
    return dest;
  }
  throw new Error(`unsupported url scheme: ${url}`);
}

/**
 * Replace silent AAC with a warm acoustic bed extracted from the pet-demo seed
 * (Kevin MacLeod "Wholesome"). Overwrites `videoPath` in place.
 */
async function applyWarmInvestorBgm(videoPath: string) {
  const audioDir = path.join(WORK_DIR, "audio");
  mkdirSync(audioDir, { recursive: true });
  const refMp4 = path.join(audioDir, "bgm-source-ref.mp4");
  const srcWav = path.join(audioDir, "bgm-src.wav");
  const bedAac = path.join(audioDir, "bgm-bed.aac");
  const outMp4 = path.join(audioDir, "final-with-bgm.mp4");

  if (!existsSync(refMp4) || statSync(refMp4).size === 0) {
    console.log(`  downloading BGM reference: ${shorten(WARM_BGM_SOURCE_URL, 72)}`);
    await downloadHttpToFile(WARM_BGM_SOURCE_URL, refMp4);
  }
  if (!existsSync(srcWav) || statSync(srcWav).size === 0) {
    await execFileAsync(
      FFMPEG_BIN,
      ["-y", "-loglevel", "error", "-i", refMp4, "-vn", "-ac", "2", "-ar", "44100", srcWav],
      { timeout: 120_000, maxBuffer: 1024 * 1024 * 50 },
    );
  }

  const durationSec = Number(
    (
      await execFileAsync(FFPROBE_BIN, [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        videoPath,
      ])
    ).stdout.trim(),
  );
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`could not probe duration for ${videoPath}`);
  }
  const fadeOutStart = Math.max(0, durationSec - 1.2).toFixed(3);

  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(WARM_BGM_SOURCE_OFFSET_SEC),
      "-t",
      String(durationSec),
      "-i",
      srcWav,
      "-af",
      `afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOutStart}:d=1.2,volume=0.30,loudnorm=I=-16:TP=-1.5:LRA=11`,
      bedAac,
    ],
    { timeout: 120_000, maxBuffer: 1024 * 1024 * 50 },
  );

  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      videoPath,
      "-i",
      bedAac,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      outMp4,
    ],
    { timeout: 120_000, maxBuffer: 1024 * 1024 * 50 },
  );

  copyFileSync(outMp4, videoPath);
}

async function uploadToBlob(
  filePath: string,
  blobPath: string,
  contentType: string,
): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  const buf = await readFile(filePath);
  const blob = await put(blobPath, buf, {
    access: "public",
    contentType,
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

function readStoryboard(): StoryboardRecord | null {
  if (!existsSync(STORYBOARD_PATH)) return null;
  return JSON.parse(readFileSync(STORYBOARD_PATH, "utf8")) as StoryboardRecord;
}
function writeStoryboard(record: StoryboardRecord) {
  writeFileSync(
    STORYBOARD_PATH,
    JSON.stringify(record, null, 2) + "\n",
    "utf8",
  );
}

function readSubmission(): SubmissionRecord | null {
  if (!existsSync(SUBMISSION_PATH)) return null;
  return JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;
}
function writeSubmission(record: SubmissionRecord) {
  writeFileSync(
    SUBMISSION_PATH,
    JSON.stringify(record, null, 2) + "\n",
    "utf8",
  );
}

function readState(): PipelineState {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as PipelineState;
}
function writeState(state: PipelineState) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/**
 * Drop downstream artifacts (final.mp4, poster, Blob URLs, watermark cache,
 * blindsBranded cache, end-card cache) so --reassemble produces a fresh cut
 * without re-paying for Seedance segments.
 */
function clearDownstreamArtifacts() {
  const state = readState();
  const toDelete = [
    state.watermarkedBaseLocal,
    state.blindsBrandedBaseLocal,
    state.endCardLocal,
    state.finalLocal,
    state.posterLocal,
    path.join(WORK_DIR, "base.mp4"),
    path.join(WORK_DIR, "stage", "wm-base.mp4"),
    path.join(WORK_DIR, "stage", "endcard-norm.mp4"),
  ].filter(Boolean) as string[];
  for (const p of toDelete) {
    if (existsSync(p)) {
      try {
        unlinkSync(p);
        console.log(`  --reassemble: cleared ${p}`);
      } catch {
        /* best effort */
      }
    }
  }
  writeState({ baseLocalSegments: state.baseLocalSegments });
}

/**
 * Clear one segment's cached artifacts so the next submit phase will
 * actually re-POST it to Seedance (instead of finding the slot already
 * filled and skipping). Does NOT touch other segments.
 */
function clearSegmentForResubmit(idx: number) {
  /// Submission slot
  const sub = readSubmission();
  if (sub) {
    const slot = sub.segments.find((s) => s.index === idx);
    if (slot) {
      console.log(
        `  --resubmit-segment=${idx}: clearing externalJobId / status / videoUrl`,
      );
      slot.externalJobId = undefined;
      slot.submittedAt = undefined;
      slot.seedanceStatus = undefined;
      slot.rawProviderStatus = undefined;
      slot.videoUrl = undefined;
      slot.thumbnailUrl = undefined;
      slot.errorMessage = undefined;
      writeSubmission(sub);
    }
  }
  /// Local raw + normalized + downstream caches must also go so re-assemble
  /// picks up the new segment instead of the cached old one.
  const candidates = [
    path.join(WORK_DIR, `raw-seg-${idx}.mp4`),
    path.join(WORK_DIR, "normalized", `seg-${idx}.mp4`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        unlinkSync(p);
        console.log(`  --resubmit-segment=${idx}: cleared ${p}`);
      } catch {
        /* best effort */
      }
    }
  }
  /// Force downstream rebuild so the new segment actually surfaces in final.mp4
  clearDownstreamArtifacts();
}

function shorten(value: string | null | undefined, n = 60): string {
  if (!value) return "—";
  return value.length <= n ? value : value.slice(0, n) + "…";
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function banner(title: string) {
  const bar = "─".repeat(Math.min(78, title.length + 4));
  console.log(`\n${bar}\n  ${title}\n${bar}`);
}

main()
  .catch((err) => {
    console.error("\n[sunny-shutter-investor-demo-v21] failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
