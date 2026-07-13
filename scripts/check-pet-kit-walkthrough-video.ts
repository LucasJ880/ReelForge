/**
 * 轮询 Aivora 宠物套件讲解视频各段 Seedance 状态。
 *
 * 用法：npm run demo:check:petkit
 * 全部完成后，运行 npm run demo:stitch:petkit 拼接成片。
 */
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
  "tmp/pet-kit-walkthrough-video/submission.json",
);

type SubmissionRecord = {
  purpose: "pet-content-kit-60s-walkthrough";
  segments: Array<{
    index: number;
    timeRange: string;
    title: string;
    caption: string;
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
        `segment ${segment.index} ${segment.timeRange} ${segment.title}: 未提交`,
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
    throw new Error("有片段失败，详见上方错误。可用 --segments 重提失败段。");
  }
  if (completed !== record.segments.length) {
    console.log("还没全部完成，请稍后重跑本命令。");
    return;
  }

  console.log("全部片段已完成。");
  for (const segment of record.segments) {
    console.log(`segment ${segment.index}: ${segment.videoUrl}`);
  }
  console.log("");
  console.log("下一步：npm run demo:stitch:petkit");
}

function readSubmissionRecord() {
  if (!existsSync(SUBMISSION_PATH)) {
    throw new Error(
      [
        `缺少提交记录：${SUBMISSION_PATH}`,
        "请先运行：npm run demo:gen:petkit",
      ].join("\n"),
    );
  }
  const record = JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;
  if (!Array.isArray(record.segments) || record.segments.length !== 4) {
    throw new Error(`提交记录不含预期的 4 段：${SUBMISSION_PATH}`);
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
        `第 ${mockJob.index} 段是 mock 任务，无法跨进程查询。`,
        "请做真实提交以获得可持久查询的 Seedance job ID。",
      ].join("\n"),
    );
  }
  if (!process.env.BYTEPLUS_ARK_API_KEY) {
    throw new Error("缺少必需环境变量：BYTEPLUS_ARK_API_KEY");
  }
}

main().catch((err) => {
  console.error("\n宠物套件讲解视频状态查询失败：");
  console.error((err as Error).message);
  process.exit(1);
});
