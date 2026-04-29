import { loadEnvConfig } from "@next/env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getSeedanceStatus,
  type SeedanceJobResult,
} from "../src/lib/providers/seedance";

loadEnvConfig(process.cwd());

const SUBMISSION_PATH = resolve(
  process.cwd(),
  "tmp/real-footage-walkthrough-video/submission.json",
);

type SubmissionRecord = {
  purpose: "real-footage-ads-60s-walkthrough";
  segments: Array<{
    index: number;
    timeRange: string;
    title: string;
    externalJobId?: string;
    seedanceStatus?: SeedanceJobResult["status"];
    progress?: number;
    videoUrl?: string;
    thumbnailUrl?: string;
    errorMessage?: string;
  }>;
};

async function main() {
  const record = readSubmissionRecord();
  assertStatusEnvironment(record);

  let completed = 0;
  let failed = 0;

  for (const segment of record.segments) {
    if (!segment.externalJobId) {
      console.log(
        `segment ${segment.index} ${segment.timeRange} ${segment.title}: not submitted`,
      );
      continue;
    }

    const status = await getSeedanceStatus(segment.externalJobId);
    segment.seedanceStatus = status.status;
    segment.progress = status.progress;
    segment.videoUrl = status.videoUrl;
    segment.thumbnailUrl = status.thumbnailUrl;
    segment.errorMessage = status.errorMessage;

    if (status.status === "completed") completed += 1;
    if (status.status === "failed") failed += 1;

    console.log(
      [
        `segment ${segment.index} ${segment.timeRange} ${segment.title}`,
        `status=${status.status}`,
        `externalJobId=${segment.externalJobId}`,
        typeof status.progress === "number" ? `progress=${status.progress}%` : "",
        status.videoUrl ? `videoUrl=${status.videoUrl}` : "",
        status.errorMessage ? `error=${status.errorMessage}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }

  writeFileSync(SUBMISSION_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`completedSegments = ${completed}/${record.segments.length}`);
  if (failed > 0) {
    console.log(`failedSegments = ${failed}`);
    throw new Error("One or more walkthrough segments failed. See segment errors above.");
  }
  if (completed !== record.segments.length) {
    console.log("Walkthrough is not ready yet. Re-run this command later.");
    return;
  }

  console.log("All segments completed.");
  console.log("Segment video URLs:");
  for (const segment of record.segments) {
    console.log(`segment ${segment.index}: ${segment.videoUrl}`);
  }
  console.log("");
  console.log("Next step: npm run demo:stitch:walkthrough");
}

function readSubmissionRecord() {
  if (!existsSync(SUBMISSION_PATH)) {
    throw new Error(
      [
        `Missing submission record: ${SUBMISSION_PATH}`,
        "Run the submission script first:",
        "  npm run demo:generate:walkthrough",
      ].join("\n"),
    );
  }

  const record = JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;
  if (!Array.isArray(record.segments) || record.segments.length !== 4) {
    throw new Error(
      [
        "Submission record does not contain the expected four segments.",
        `Record: ${SUBMISSION_PATH}`,
      ].join("\n"),
    );
  }

  return record;
}

function assertStatusEnvironment(record: SubmissionRecord) {
  const mockJob = record.segments.find((segment) =>
    segment.externalJobId?.startsWith("mock_"),
  );
  if (mockJob) {
    throw new Error(
      [
        `Segment ${mockJob.index} uses a mock Seedance job.`,
        "Mock Seedance jobs are in-memory and cannot be checked from a separate process.",
        "Run a real submission for persistent Seedance job IDs.",
      ].join("\n"),
    );
  }

  if (!process.env.ARK_API_KEY) {
    throw new Error(
      [
        "Missing required Seedance env vars: ARK_API_KEY",
        "ARK_BASE_URL is optional; provider defaults to https://ark.cn-beijing.volces.com/api/v3.",
      ].join("\n"),
    );
  }
}

main().catch((err) => {
  console.error("\nWalkthrough Seedance status check failed:");
  console.error((err as Error).message);
  process.exit(1);
});
