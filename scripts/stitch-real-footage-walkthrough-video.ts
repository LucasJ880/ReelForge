import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

loadEnvConfig(process.cwd());

const WORK_DIR = resolve(process.cwd(), "tmp/real-footage-walkthrough-video");
const SEGMENT_DIR = resolve(WORK_DIR, "segments");
const NORMALIZED_DIR = resolve(WORK_DIR, "normalized");
const SUBMISSION_PATH = resolve(WORK_DIR, "submission.json");
const CONCAT_LIST_PATH = resolve(WORK_DIR, "concat-list.txt");
const PUBLIC_OUTPUT_DIR = resolve(process.cwd(), "public/generated");
const FINAL_OUTPUT_PATH = resolve(
  PUBLIC_OUTPUT_DIR,
  "aivora-real-footage-ads-walkthrough-60s-16x9.mp4",
);

type SubmissionRecord = {
  segments: Array<{
    index: number;
    videoUrl?: string;
  }>;
};

async function main() {
  ensureTools();
  ensureDir(SEGMENT_DIR);
  ensureDir(NORMALIZED_DIR);
  ensureDir(PUBLIC_OUTPUT_DIR);

  const inputs = readInputs();
  if (inputs.length !== 4) {
    throw new Error(`Expected 4 segment inputs, received ${inputs.length}.`);
  }

  banner("Preparing segment inputs");
  const localInputs: string[] = [];
  for (const [index, input] of inputs.entries()) {
    const localPath = await prepareInput(input, index + 1);
    localInputs.push(localPath);
    console.log(`segment ${index + 1} input = ${localPath}`);
  }

  banner("Normalizing segments");
  const normalizedPaths = localInputs.map((input, index) => {
    const out = resolve(NORMALIZED_DIR, `segment-${index + 1}.mp4`);
    normalizeSegment(input, out);
    console.log(`segment ${index + 1} normalized = ${out}`);
    return out;
  });

  banner("Stitching final walkthrough");
  writeConcatList(normalizedPaths);
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    CONCAT_LIST_PATH,
    "-c",
    "copy",
    FINAL_OUTPUT_PATH,
  ], { stdio: "inherit" });

  console.log("finalLocalPath =", FINAL_OUTPUT_PATH);

  if (isTruthy(process.env.UPLOAD_WALKTHROUGH_TO_BLOB)) {
    const url = await uploadToBlob(FINAL_OUTPUT_PATH);
    console.log("finalBlobUrl =", url);
    console.log("Set DEMO_WALKTHROUGH_VIDEO_URL to this URL.");
  } else {
    console.log(
      "Upload this MP4 to Vercel Blob or your chosen storage, then set DEMO_WALKTHROUGH_VIDEO_URL to the public URL.",
    );
  }
}

function readInputs() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (args.length > 0) return args;

  if (!existsSync(SUBMISSION_PATH)) {
    throw new Error(
      [
        "No segment inputs provided and no submission record found.",
        "Run: npm run demo:check:walkthrough",
        "Then: npm run demo:stitch:walkthrough",
        "Or pass four segment MP4 URLs/files explicitly.",
      ].join("\n"),
    );
  }

  const record = JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;
  const segments = [...record.segments].sort((a, b) => a.index - b.index);
  const missing = segments.filter((segment) => !segment.videoUrl);
  if (segments.length !== 4 || missing.length > 0) {
    throw new Error(
      [
        "Submission record does not contain four completed segment video URLs.",
        "Run: npm run demo:check:walkthrough",
        "Do not stitch until all four segments are completed.",
      ].join("\n"),
    );
  }

  return segments.map((segment) => segment.videoUrl as string);
}

async function prepareInput(input: string, index: number) {
  if (isRemoteUrl(input)) {
    const out = resolve(SEGMENT_DIR, `segment-${index}-source.mp4`);
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(
        `Failed to download segment ${index}: ${response.status} ${response.statusText}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(out, buffer);
    return out;
  }

  const local = input.startsWith("file://") ? input.slice("file://".length) : input;
  const resolved = isAbsolute(local) ? local : resolve(process.cwd(), local);
  if (!existsSync(resolved)) {
    throw new Error(`Segment ${index} file does not exist: ${resolved}`);
  }
  return resolved;
}

function normalizeSegment(input: string, output: string) {
  const videoFilter =
    "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p";

  if (hasAudio(input)) {
    execFileSync("ffmpeg", [
      "-y",
      "-i",
      input,
      "-vf",
      videoFilter,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-ar",
      "44100",
      "-ac",
      "2",
      output,
    ], { stdio: "inherit" });
    return;
  }

  execFileSync("ffmpeg", [
    "-y",
    "-i",
    input,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf",
    videoFilter,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    output,
  ], { stdio: "inherit" });
}

function hasAudio(input: string) {
  try {
    const output = execFileSync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      input,
    ]).toString("utf8");
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

function writeConcatList(paths: string[]) {
  const body = paths.map((path) => `file '${escapeConcatPath(path)}'`).join("\n");
  writeFileSync(CONCAT_LIST_PATH, `${body}\n`, "utf8");
}

function escapeConcatPath(path: string) {
  return path.replace(/'/g, "'\\''");
}

async function uploadToBlob(path: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "UPLOAD_WALKTHROUGH_TO_BLOB=true requires BLOB_READ_WRITE_TOKEN.",
    );
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

function ensureDir(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
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
  console.error("\nWalkthrough stitching failed:");
  console.error((err as Error).message);
  process.exit(1);
});
