import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
/// brand-end-card-renderer chooses local vs deferred-external by NODE_ENV; for
/// this script we always want LOCAL ffmpeg so the end card actually renders.
process.env.STITCH_RUNTIME = process.env.STITCH_RUNTIME || "local";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import bcrypt from "bcryptjs";
import { put } from "@vercel/blob";
import {
  FinalVideoStatus,
  PrismaClient,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import {
  getSeedanceStatus,
  submitSeedanceJob,
} from "../src/lib/providers/seedance";
import { renderBrandEndCard } from "../src/lib/video-generation/brand-end-card-renderer";
import { applyBrandOverlay } from "../src/lib/video-generation/brand-overlay-renderer";
import type { BrandPackagingPlan } from "../src/types/video-generation";

/**
 * Sunny Shutter Investor Demo Pipeline — V1 (text-to-video, frozen reference)
 * ===========================================================================
 *
 * One-shot script that produces a polished ~30s Sunny Shutter investor demo
 * video and lands it on /personal/videos as a "ready" entry.
 *
 * NOTE — 2026-05 V2.1 transition:
 *   The investor-facing iteration moved to image-storyboard-guided I2V in
 *   `scripts/sunny-shutter-investor-demo-v21.ts`. This V1 script is kept as
 *   a frozen, working reference for the original pure-T2V pipeline (its
 *   already-published demo entry on /personal/videos was approved by the
 *   user). Do not change V1 prompts/flags here — make new behavior in v21.
 *
 * Phases (orchestrated automatically, all idempotent + resumable):
 *
 *   1. submit   — POST 5 base segments to Seedance (5s each, 9:16, with
 *                 generate_audio=true). Persists submission.json so the script
 *                 can be killed + re-run without burning credits twice.
 *
 *   2. wait     — Polls each Seedance task until it's completed/failed.
 *                 Records videoUrl per segment.
 *
 *   3. assemble — Downloads each segment, normalizes to 720x1280@30fps,
 *                 concatenates 5 segments, applies the real Sunny logo as a
 *                 top-right watermark via the Brand Overlay Layer, then
 *                 appends a 5s rendered Brand End Card (also using the real
 *                 logo). Uploads final MP4 + poster JPG to Vercel Blob.
 *
 *   4. publish  — Upserts a dedicated PERSONAL demo user, then creates the
 *                 DeliveryOrder + Round + ContentAngle + VideoBrief +
 *                 FinalVideo + 5 SUCCEEDED VideoJobs so the entry shows up on
 *                 /personal/videos as "已完成" with a working video link.
 *
 * Hard rules:
 *   - The Sunny logo is NEVER asked of Seedance. All branding (watermark +
 *     end card) is composited post-render with the real PNG.
 *   - Each Seedance segment prompt explicitly forbids logo / brand text.
 *   - All customer-visible strings are checked against banned-internal-terms.
 *
 * Usage:
 *   npx tsx scripts/sunny-shutter-investor-demo.ts                # full pipeline
 *   npx tsx scripts/sunny-shutter-investor-demo.ts --phase=submit
 *   npx tsx scripts/sunny-shutter-investor-demo.ts --phase=wait
 *   npx tsx scripts/sunny-shutter-investor-demo.ts --phase=assemble
 *   npx tsx scripts/sunny-shutter-investor-demo.ts --phase=publish
 *   npx tsx scripts/sunny-shutter-investor-demo.ts --dry-run        # no Seedance calls
 *   npx tsx scripts/sunny-shutter-investor-demo.ts --reset-publish  # delete prior demo entry first
 */

// =============================================================
// Constants
// =============================================================

const PROJECT_ROOT = process.cwd();
const WORK_DIR = path.resolve(PROJECT_ROOT, "tmp/sunny-shutter-investor-demo");
const SUBMISSION_PATH = path.join(WORK_DIR, "submission.json");
const STATE_PATH = path.join(WORK_DIR, "state.json");
const LOGO_PATH = path.resolve(PROJECT_ROOT, "public/brand/sunny-logo.png");

const ASPECT_RATIO = "9:16" as const;
const TARGET_WIDTH = 720;
const TARGET_HEIGHT = 1280;
const FPS = 30;

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
const BRAND_CTA = "Learn more";
const BRAND_WEBSITE = "sunnyshutter.ca";

/// Negative-prompt clause appended to every base segment so Seedance never
/// renders fake brand text or distorted hands.
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
  "premium cinematic commercial style",
  "warm, restrained, human-centered",
].join(", ");

// =============================================================
// Segment plan (verbatim from the spec; logo is never requested)
// =============================================================

interface SegmentPlan {
  index: number; // 1-based for human readability
  timeRange: string;
  title: string;
  durationSec: number;
  prompt: string;
}

const SEGMENT_PLAN: SegmentPlan[] = [
  {
    index: 1,
    timeRange: "0–5s",
    title: "Morning light / setup",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    prompt:
      "A quiet modern Canadian suburban living room in the early morning. Warm sunlight streams through zebra blinds, creating bright bands of light across a side table, a cup of tea, and an open book. The atmosphere is calm, premium, minimal, and realistic. Slow cinematic push-in, soft natural light, shallow depth of field, gentle shadows, warm neutral color grade. No text, no logo, no brand mark, no AI-generated signage.",
  },
  {
    index: 2,
    timeRange: "5–10s",
    title: "Human moment / independence",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    prompt:
      "An elderly person sits comfortably in a soft armchair with a book and tea beside them. They are calm, composed, and independent. The sunlight is a little too bright on their face, and they gently pause from reading. Their expression is subtle and natural, not helpless and not exaggerated. Premium cinematic framing, warm tones, realistic skin texture, quiet human-centered mood, soft morning light, no text, no logo.",
  },
  {
    index: 3,
    timeRange: "10–15s",
    title: "Simple control / phone tap",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    prompt:
      "Close-up of an elderly person's hand gently picking up a smartphone from a side table. They tap the screen once with a calm, confident gesture. The phone interface is not readable and not emphasized. The focus is on ease, independence, and quiet control. Clean cinematic close-up, soft morning light, realistic hand movement, natural fingers, no distorted hands, no extra fingers, no readable text on the phone, no logo.",
  },
  {
    index: 4,
    timeRange: "15–20s",
    title: "Product hero / blinds move",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    prompt:
      "Elegant motorized zebra blinds slowly adjust in a modern living room window. The bright sunlight softens into a warm, comfortable glow. The motion is smooth, quiet, and premium. Dust particles gently catch the light. The room becomes calmer and more comfortable. Cinematic product hero shot, realistic blinds movement, straight vertical window lines, clean zebra blinds, no warped blinds, no flickering stripes, soft shadows, no text, no logo.",
  },
  {
    index: 5,
    timeRange: "20–25s",
    title: "Family sees independence",
    durationSec: BASE_SEGMENT_DURATION_SEC,
    prompt:
      "A family member stands nearby in the kitchen area, noticing the elderly person comfortably adjusting the blinds by themselves. They smile softly with quiet reassurance, not rushing to help. The elderly person continues reading peacefully. The moment feels warm, respectful, and understated. Human-centered cinematic commercial style, natural acting, warm home interior, emotional but restrained, no text, no logo.",
  },
];

// =============================================================
// Persistent state types
// =============================================================

interface SubmissionRecord {
  purpose: "sunny-shutter-investor-demo-30s";
  ratio: typeof ASPECT_RATIO;
  segmentDurationSec: number;
  segments: Array<{
    index: number;
    title: string;
    timeRange: string;
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
  | "submit"
  | "wait"
  | "assemble"
  | "publish";
const DRY_RUN = hasFlag("dry-run");
const RESET_PUBLISH = hasFlag("reset-publish");

// =============================================================
// Main entry
// =============================================================

const execFileAsync = promisify(execFile);
const db = new PrismaClient();

async function main() {
  banner("Sunny Shutter Investor Demo Pipeline");
  console.log(`workDir       = ${WORK_DIR}`);
  console.log(`logo          = ${LOGO_PATH}`);
  console.log(`segments      = ${BASE_SEGMENT_COUNT} × ${BASE_SEGMENT_DURATION_SEC}s base + ${END_CARD_DURATION_SEC}s end card = ${TARGET_TOTAL_SEC}s`);
  console.log(`phase         = ${PHASE}`);
  console.log(`dryRun        = ${DRY_RUN}`);
  console.log(`personalUser  = ${DEMO_USER_EMAIL}`);

  preflight();
  mkdirSync(WORK_DIR, { recursive: true });

  if (PHASE === "all" || PHASE === "submit") {
    await phaseSubmit();
  }
  if (PHASE === "all" || PHASE === "wait") {
    await phaseWait();
  }
  if (PHASE === "all" || PHASE === "assemble") {
    await phaseAssemble();
  }
  if (PHASE === "all" || PHASE === "publish") {
    await phasePublish();
  }

  banner("Done");
  const state = readState();
  console.log("finalBlobUrl  =", state.finalBlobUrl ?? "(not produced)");
  console.log("posterBlobUrl =", state.posterBlobUrl ?? "(not produced)");
  console.log(
    "deliveryOrder =",
    state.publishedDeliveryOrderId ?? "(not published)",
  );
  console.log(`Sign in at /login as ${DEMO_USER_EMAIL} to view it on /personal/videos.`);
}

// =============================================================
// Preflight
// =============================================================

function preflight() {
  banner("Preflight");
  const missing: string[] = [];
  if (!process.env.ARK_API_KEY && !DRY_RUN) missing.push("ARK_API_KEY");
  if (!process.env.BLOB_READ_WRITE_TOKEN && !DRY_RUN) {
    missing.push("BLOB_READ_WRITE_TOKEN");
  }
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
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
  if (!existsSync(LOGO_PATH) || statSync(LOGO_PATH).size === 0) {
    throw new Error(
      `Sunny logo not found at ${LOGO_PATH}. Drop the real logo PNG there and re-run.`,
    );
  }
  console.log("preflight = ok");
}

// =============================================================
// Phase 1 — Submit
// =============================================================

async function phaseSubmit() {
  banner("Phase 1 — Submit Seedance segments");

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
    purpose: "sunny-shutter-investor-demo-30s",
    ratio: ASPECT_RATIO,
    segmentDurationSec: BASE_SEGMENT_DURATION_SEC,
    segments: SEGMENT_PLAN.map((s) => ({
      index: s.index,
      title: s.title,
      timeRange: s.timeRange,
    })),
  };

  for (const plan of SEGMENT_PLAN) {
    const slot = record.segments.find((s) => s.index === plan.index);
    if (slot?.externalJobId) {
      console.log(
        `  segment ${plan.index}: already submitted (externalJobId=${slot.externalJobId}), skipping`,
      );
      continue;
    }

    const fullPrompt = `${plan.prompt} Negative guidance: ${SHARED_NEGATIVE_GUIDANCE}.`;
    if (DRY_RUN) {
      console.log(
        `  segment ${plan.index} [DRY RUN]: would submit ${plan.durationSec}s @ 9:16 — promptChars=${fullPrompt.length}`,
      );
      continue;
    }
    const submission = await submitSeedanceJob({
      prompt: fullPrompt,
      duration: plan.durationSec,
      ratio: ASPECT_RATIO,
    });
    const updated = {
      index: plan.index,
      title: plan.title,
      timeRange: plan.timeRange,
      externalJobId: submission.jobId,
      submittedAt: new Date().toISOString(),
    };
    record.segments = record.segments.map((s) =>
      s.index === plan.index ? updated : s,
    );
    writeSubmission(record);
    console.log(
      `  segment ${plan.index} submitted: externalJobId=${submission.jobId}`,
    );
  }
}

// =============================================================
// Phase 2 — Wait for Seedance completion
// =============================================================

async function phaseWait() {
  banner("Phase 2 — Wait for Seedance to finish");
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
        `${failed} Seedance segments failed. Inspect ${SUBMISSION_PATH} and decide whether to re-submit.`,
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
// Phase 3 — Assemble (download → concat → watermark → end card → upload)
// =============================================================

async function phaseAssemble() {
  banner("Phase 3 — Assemble final video");
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

  /// 3.1 Download + normalize each segment to a uniform 720x1280@30fps mp4
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
    console.log(`  segment ${s.index}: normalizing → ${out}`);
    await normalizeOneSegment(localInput, out);
    normalized.push(out);
  }
  state.baseLocalSegments = normalized;
  writeState(state);

  /// 3.2 Concatenate normalized segments → base.mp4 (~25s)
  const baseLocal = path.join(WORK_DIR, "base.mp4");
  if (!existsSync(baseLocal) || statSync(baseLocal).size === 0) {
    console.log("  concatenating segments → base.mp4");
    await concatNormalized(normalized, baseLocal);
  } else {
    console.log("  base.mp4: cached");
  }

  /// 3.3 Apply watermark via Brand Overlay Layer (the ONLY way the real logo
  ///     enters the base footage — Seedance never sees it).
  let watermarked = state.watermarkedBaseLocal;
  if (!watermarked || !existsSync(watermarked)) {
    console.log("  applying brand overlay watermark (top-right, opacity 0.82, 16% width)");
    const overlay = await applyBrandOverlay({
      sourceVideo: baseLocal,
      logo: LOGO_PATH,
      placement: "top-right",
      opacity: 0.82,
      logoWidthRatio: 0.16,
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

  /// 3.4 Render Brand End Card with the real logo composited on top.
  let endCardLocal = state.endCardLocal;
  if (!endCardLocal || !existsSync(endCardLocal)) {
    console.log("  rendering brand end card (5s, real logo composited)");
    const plan: BrandPackagingPlan = {
      mode: "auto_end_card",
      logoAssetId: null,
      endCardDurationSeconds: END_CARD_DURATION_SEC,
      cta: BRAND_CTA,
      brandName: BRAND_NAME,
      slogan: BRAND_SLOGAN,
      website: BRAND_WEBSITE,
      renderStrategy: "render_ffmpeg_overlay",
      warnings: [],
    };
    const result = await renderBrandEndCard({
      briefId: "sunny-shutter-investor-demo",
      aspectRatio: ASPECT_RATIO,
      plan,
      logoUrl: pathToFileURL(LOGO_PATH).toString(),
    });
    if (!result || !result.url) {
      throw new Error(
        `End card not produced (source=${result?.source ?? "null"}). ${result?.warnings.join(" | ") ?? ""}`,
      );
    }
    endCardLocal = await materializeUrl(result.url, path.join(WORK_DIR, "endcard.mp4"));
    console.log(`  end card: ${endCardLocal}`);
    if (result.warnings.length > 0) {
      console.log(`  end card warnings: ${result.warnings.join(" | ")}`);
    }
  } else {
    console.log(`  end card: cached at ${endCardLocal}`);
  }
  state.endCardLocal = endCardLocal;
  writeState(state);

  /// 3.5 Concatenate watermarked base + end card → final.mp4
  const finalLocal = path.join(WORK_DIR, "final.mp4");
  if (!existsSync(finalLocal) || statSync(finalLocal).size === 0) {
    console.log("  concatenating watermarked base + end card → final.mp4");
    /// re-normalize end card too, since it was rendered at 720x1280@30 already
    /// but the watermarked base was re-encoded with a different preset; using
    /// concat demuxer requires identical streams → safer to normalize again.
    const stagingDir = path.join(WORK_DIR, "stage");
    mkdirSync(stagingDir, { recursive: true });
    const stage1 = path.join(stagingDir, "wm-base.mp4");
    const stage2 = path.join(stagingDir, "endcard-norm.mp4");
    await normalizeOneSegment(watermarked, stage1);
    await normalizeOneSegment(endCardLocal, stage2);
    await concatNormalized([stage1, stage2], finalLocal);
  } else {
    console.log("  final.mp4: cached");
  }
  state.finalLocal = finalLocal;
  writeState(state);

  /// 3.6 Generate poster (first-frame JPG)
  const posterLocal = path.join(WORK_DIR, "poster.jpg");
  if (!existsSync(posterLocal) || statSync(posterLocal).size === 0) {
    console.log("  extracting poster frame → poster.jpg");
    await extractPoster(finalLocal, posterLocal);
  } else {
    console.log("  poster.jpg: cached");
  }
  state.posterLocal = posterLocal;
  writeState(state);

  /// 3.7 Upload final + poster to Vercel Blob (idempotent: overwrite=true)
  if (!state.finalBlobUrl) {
    console.log("  uploading final.mp4 to Vercel Blob");
    state.finalBlobUrl = await uploadToBlob(
      finalLocal,
      `personal-demos/sunny-shutter-investor-demo-${nowStamp()}.mp4`,
      "video/mp4",
    );
    writeState(state);
  }
  if (!state.posterBlobUrl) {
    console.log("  uploading poster.jpg to Vercel Blob");
    state.posterBlobUrl = await uploadToBlob(
      posterLocal,
      `personal-demos/sunny-shutter-investor-demo-${nowStamp()}-poster.jpg`,
      "image/jpeg",
    );
    writeState(state);
  }
  console.log(`  finalBlobUrl  = ${state.finalBlobUrl}`);
  console.log(`  posterBlobUrl = ${state.posterBlobUrl}`);
}

// =============================================================
// Phase 4 — Publish to /personal/videos
// =============================================================

async function phasePublish() {
  banner("Phase 4 — Publish to /personal/videos");
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

  /// 4.1 Upsert PERSONAL demo user
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

  /// 4.2 Optional reset: drop any prior demo entry for this user (by exact title).
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

  /// 4.3 Reuse existing demo order if one already exists; otherwise create the
  ///     full DeliveryOrder → Round → ContentAngle → VideoBrief → FinalVideo
  ///     → 5 SUCCEEDED VideoJobs graph in a single transaction.
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
    /// Refresh URLs onto the existing brief / finalVideo so a re-render
    /// updates the entry in place.
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
          source: "investor_demo",
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
        hook: "Technology should quietly support comfort, dignity, and independence.",
        narrative:
          "An elderly person taps once on a phone; the motorized blinds soften the morning light, and a family member smiles from the kitchen. Calm, premium, restrained.",
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

    /// Create the 5 SUCCEEDED VideoJob rows so the scene-progress UI
    /// renders a clean 5/5 grid.
    for (const segment of submission.segments) {
      await tx.videoJob.create({
        data: {
          videoBriefId: brief.id,
          provider: VideoProvider.SEEDANCE_T2V,
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
  console.log(`  created videoBrief    ${created.brief.id} (persona=PERSONAL, status=QA_APPROVED)`);
  console.log(`  created finalVideo    ${created.finalVideo.id} (status=READY)`);
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
        include: { angles: { include: { videoBrief: { include: { finalVideo: true, videoJobs: true } } } } },
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
  /// Refresh job URLs in case a re-run swapped Seedance segments
  for (const seg of submission.segments) {
    const job = brief.videoJobs.find((j) => j.segmentIndex === seg.index - 1);
    if (!job) continue;
    await db.videoJob.update({
      where: { id: job.id },
      data: {
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

async function normalizeOneSegment(input: string, output: string) {
  await execFileAsync(
    FFMPEG_BIN,
    [
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
      `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v];[0:a?][1:a]amerge=inputs=2,pan=stereo|c0=c0|c1=c1[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
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
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 * 50 },
  );
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

// =============================================================
// I/O helpers
// =============================================================

async function downloadHttpToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed (${res.status} ${res.statusText}) for ${shorten(url, 80)}`);
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

function readSubmission(): SubmissionRecord | null {
  if (!existsSync(SUBMISSION_PATH)) return null;
  return JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;
}

function writeSubmission(record: SubmissionRecord) {
  writeFileSync(SUBMISSION_PATH, JSON.stringify(record, null, 2) + "\n", "utf8");
}

function readState(): PipelineState {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as PipelineState;
}

function writeState(state: PipelineState) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
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
    console.error("\n[sunny-shutter-investor-demo] failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
