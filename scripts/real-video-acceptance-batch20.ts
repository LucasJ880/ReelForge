/**
 * Real-provider acceptance · 20 视频批量验收（第 1 部分：18 × 15s 单条）。
 *
 * 与 real-video-acceptance-backend.ts 同构（走完整持久化批量管线 + volcengine_cn_legacy 火山线路），
 * 扩展点：
 *   - 18 条 15s（7 个 ACTIVE 15s 模板轮转，每条 2-3 次）
 *   - 每条使用确定性乱序后的 4 张产品图子集（覆盖不同图组组合）
 *   - 断点续跑：幂等键 + JSON 报告
 *
 * 第 2 部分（2 × 30s 拼接 + 口播字幕）见 real-video-acceptance-30s.ts。
 *
 * 百叶安全镜头硬闸：dispatch 前由 quality-reviewer + shutter-shot-policy 拦截
 * 手拧中杆等自杀镜头（见 docs/acceptance/shutter-safe-shot-policy.md）。
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { StyleTemplateStatus } from "@prisma/client";
import { put } from "@vercel/blob";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import {
  createBatchJob,
  getBatchStatus,
  isTerminalBatchStatus,
  processBatchTick,
} from "@/lib/services/batch-service";
import { authorizeBatchQuotaForSession } from "@/lib/services/quota-service";
import { VOLCENGINE_CN_ARK_BASE_URL } from "@/lib/config/seedance-runtime";
import { SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS } from "@/lib/video-generation/sunnyshutter-commerce-template";

// dev 模式加载 env：.env.production.local 里是轮转前的过期 DB 凭证，
// 必须走 .env.local（同一个生产 Neon 库、有效的 app 角色）。
loadEnvConfig(process.cwd(), true);

// Paid-provider acceptance harness：本进程显式指定火山 Seedance legacy 线路，
// 防止本地 VIDEO_ENGINE_MOCK=true 把验收静默降级成 mock。
process.env.VIDEO_ENGINE_MOCK = "false";
process.env.VIDEO_PROVIDER = "byteplus";
process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
process.env.ARK_BASE_URL = VOLCENGINE_CN_ARK_BASE_URL;
process.env.ARK_VIDEO_MODEL = "doubao-seedance-2-0-260128";

const RUN_KEY =
  process.env.REAL_ACCEPTANCE_RUN_KEY?.trim() ||
  "real-acceptance-20260719-volc-batch18-v2";
const ITEM_COUNT = 18;
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-video-acceptance");
const RUN_TAG = RUN_KEY.replace(/^real-acceptance-\d+-/, "");
const REPORT_PATH = resolve(OUTPUT_DIR, `${RUN_TAG}.json`);
const VIDEO_DIR = resolve(OUTPUT_DIR, `${RUN_TAG}-videos`);
/// 局部重跑：REAL_ACCEPTANCE_INDICES="7,8,9"（默认全量 1..18）。
/// 模板/图组仍按全局 index 确定性派生，保证与整批矩阵一致。
const ITEM_INDICES: number[] = (() => {
  const parsed = (process.env.REAL_ACCEPTANCE_INDICES ?? "")
    .split(",")
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= ITEM_COUNT);
  return parsed.length > 0
    ? [...new Set(parsed)].sort((a, b) => a - b)
    : Array.from({ length: ITEM_COUNT }, (_, i) => i + 1);
})();
/// 连续 tick 之间的间隔：给内容审核/供应商留出喘息，避免自我制造限流风暴。
const TICK_SPACING_MS = 1_200;
const POLL_MS = 20_000;
const MAX_WAIT_MS = 90 * 60_000;
const IMAGES_PER_ITEM = 4;

const SOURCE_PATHS = [
  "/Users/evan/Downloads/2024-11-14 14.10.56.jpg",
  "/Users/evan/Downloads/2024-11-14 14.10.46.jpg",
  "/Users/evan/Downloads/2024-03-14 11.55.01.jpeg",
  "/Users/evan/Downloads/2024-01-31 10.39.03.jpeg",
  "/Users/evan/Downloads/2026-04-29 16.04.00.jpg",
  "/Users/evan/Downloads/2024-03-07 15.33.02.jpeg",
  "/Users/evan/Downloads/2024-01-23 14.47.09.jpeg",
] as const;

/// 通用风格库已下线；本验收脚本改走 SunnyShutter 电商族。
/// 新批量请优先用 real-video-acceptance-sunnyshutter-batch10.ts。
const CANDIDATE_TEMPLATE_SLUGS = SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS.map(
  (seed) => seed.slug,
);

type ReportItem = {
  index: number;
  idempotencyKey: string;
  templateId: string;
  templateSlug: string;
  templateNameZh: string;
  imageIds: string[];
  batchId: string;
  videoJobId?: string;
  externalJobId?: string | null;
  status?: string;
  providerStatus?: string | null;
  submittedAt?: string | null;
  finishedAt?: string | null;
  outputVideoUrl?: string | null;
  localPath?: string | null;
  error?: string | null;
};

type Report = {
  runKey: string;
  purpose: "backend-18x15s-real-provider-acceptance";
  providerRoute: "volcengine_cn_legacy";
  requestedCount: number;
  durationSec: 15;
  startedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
  sourceAssets: Array<{
    id: string;
    localPath: string;
    blobUrl: string;
  }>;
  templateOrder: string[];
  items: ReportItem[];
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

function hashOf(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function deterministicTemplateOrder<T extends { slug: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    hashOf(`${RUN_KEY}:${left.slug}`).localeCompare(hashOf(`${RUN_KEY}:${right.slug}`)),
  );
}

/** 每条视频取确定性乱序后的前 IMAGES_PER_ITEM 张，保证组合覆盖多样且可复现。 */
function imagesForItem(
  index: number,
  assets: Report["sourceAssets"],
): Report["sourceAssets"] {
  const shuffled = [...assets].sort((left, right) =>
    hashOf(`${RUN_KEY}:item-${index}:${left.id}`).localeCompare(
      hashOf(`${RUN_KEY}:item-${index}:${right.id}`),
    ),
  );
  return shuffled.slice(0, IMAGES_PER_ITEM);
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

async function downloadCompletedVideos(report: Report): Promise<void> {
  mkdirSync(VIDEO_DIR, { recursive: true });
  for (const item of report.items) {
    if (!item.outputVideoUrl) continue;
    const path = resolve(
      VIDEO_DIR,
      `batch20-${String(item.index).padStart(2, "0")}-${item.templateSlug}.mp4`,
    );
    if (!existsSync(path)) {
      const response = await fetch(item.outputVideoUrl);
      if (!response.ok) {
        throw new Error(`download ${item.index} failed (${response.status})`);
      }
      writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    }
    item.localPath = path;
    writeReport(report);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const existing = readReport();
  const sourceAssets = await uploadAssets(existing);
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const user = await db.adminUser.findFirst({
    where: adminEmail ? { email: adminEmail } : { role: "SUPER_ADMIN" },
  });
  if (!user) throw new Error("No acceptance user found");

  const templates = await db.styleTemplate.findMany({
    where: {
      slug: { in: [...CANDIDATE_TEMPLATE_SLUGS] },
      status: StyleTemplateStatus.ACTIVE,
    },
  });
  const compatible = templates.filter((template) => {
    const params = template.lockedParams as { duration?: unknown };
    const images = template.imagesPerVideo as { min?: unknown };
    return params.duration === 15 && Number(images.min) <= IMAGES_PER_ITEM;
  });
  if (compatible.length !== CANDIDATE_TEMPLATE_SLUGS.length) {
    throw new Error(
      `Expected ${CANDIDATE_TEMPLATE_SLUGS.length} compatible templates, found ${compatible.length}`,
    );
  }
  const templateOrder = deterministicTemplateOrder(compatible);
  const report: Report = existing ?? {
    runKey: RUN_KEY,
    purpose: "backend-18x15s-real-provider-acceptance",
    providerRoute: "volcengine_cn_legacy",
    requestedCount: ITEM_INDICES.length,
    durationSec: 15,
    startedAt: new Date().toISOString(),
    sourceAssets,
    templateOrder: templateOrder.map((template) => template.slug),
    items: [],
  };
  report.sourceAssets = sourceAssets;
  if (report.items.length === 0) {
    report.startedAt = new Date().toISOString();
  }
  writeReport(report);

  const session = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: null,
      role: user.role,
      userType: user.userType,
    },
  } as Session;
  for (const index of ITEM_INDICES) {
    const template = templateOrder[(index - 1) % templateOrder.length];
    const idempotencyKey = `${RUN_KEY}:${index}`;
    const itemImages = imagesForItem(index, sourceAssets);
    const batch = await createBatchJob({
      userId: user.id,
      templateId: template.id,
      templateVersion: template.version,
      images: itemImages.map((asset) => ({ id: asset.id, url: asset.blobUrl })),
      requestedCount: 1,
      productName: "Custom plantation shutters / 定制实木百叶窗",
      idempotencyKey,
      videoRouteId: "volcengine_cn_legacy",
      isInternalStaff: true,
    });
    await authorizeBatchQuotaForSession(session, batch.id);
    const priorIndex = report.items.findIndex((item) => item.index === index);
    const item: ReportItem = {
      index,
      idempotencyKey,
      templateId: template.id,
      templateSlug: template.slug,
      templateNameZh: template.nameZh,
      imageIds: itemImages.map((asset) => asset.id),
      batchId: batch.id,
      ...(priorIndex >= 0 ? report.items[priorIndex] : {}),
    };
    if (priorIndex >= 0) report.items[priorIndex] = item;
    else report.items.push(item);
    writeReport(report);
  }

  // Paid-provider canary：先只提交第 1 条；被 provider 明确拒绝就立即停止，
  // 避免把剩余 17 条也白白提交。
  const canary = report.items[0];
  const canaryBefore = await getBatchStatus(canary.batchId, user.id);
  if (!isTerminalBatchStatus(canaryBefore.status)) {
    await processBatchTick(canary.batchId);
  }
  const canaryAfter = await getBatchStatus(canary.batchId, user.id);
  const canaryJob = canaryAfter.videoJobs[0];
  canary.videoJobId = canaryJob?.id;
  canary.externalJobId = canaryJob?.externalJobId;
  canary.status = canaryJob?.status ?? canaryAfter.status;
  canary.providerStatus = canaryJob?.lastProviderStatus;
  canary.submittedAt = canaryJob?.submittedAt?.toISOString() ?? null;
  canary.finishedAt = canaryJob?.finishedAt?.toISOString() ?? null;
  canary.outputVideoUrl = canaryJob?.outputVideoUrl;
  canary.error = canaryJob?.errorMessage ?? canaryJob?.userSafeError ?? null;
  writeReport(report);
  if (!canary.externalJobId) {
    throw new Error(
      `Paid-provider canary was not accepted: ${canary.error ?? canary.status}`,
    );
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    for (const item of report.items) {
      const current = await getBatchStatus(item.batchId, user.id);
      if (!isTerminalBatchStatus(current.status)) {
        await processBatchTick(item.batchId);
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, TICK_SPACING_MS),
        );
      }
    }
    let terminalCount = 0;
    for (const item of report.items) {
      const current = await getBatchStatus(item.batchId, user.id);
      const job = current.videoJobs[0];
      item.videoJobId = job?.id;
      item.externalJobId = job?.externalJobId;
      item.status = job?.status ?? current.status;
      item.providerStatus = job?.lastProviderStatus;
      item.submittedAt = job?.submittedAt?.toISOString() ?? null;
      item.finishedAt = job?.finishedAt?.toISOString() ?? null;
      item.outputVideoUrl = job?.outputVideoUrl;
      item.error = job?.errorMessage ?? job?.userSafeError ?? null;
      if (isTerminalBatchStatus(current.status)) terminalCount += 1;
    }
    writeReport(report);
    const counts = Object.groupBy(report.items, (item) => item.status ?? "UNKNOWN");
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        terminalCount,
        statuses: Object.fromEntries(
          Object.entries(counts).map(([key, values]) => [key, values?.length ?? 0]),
        ),
      }),
    );
    if (terminalCount === report.items.length) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, POLL_MS));
  }

  const terminal = report.items.every((item) =>
    ["SUCCEEDED", "FAILED", "CANCELLED"].includes(item.status ?? ""),
  );
  if (!terminal) throw new Error(`Batch20 run timed out; resume with the same command`);
  report.finishedAt = new Date().toISOString();
  report.elapsedMs =
    new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  writeReport(report);
  await downloadCompletedVideos(report);
  console.log(JSON.stringify({ reportPath: REPORT_PATH, elapsedMs: report.elapsedMs }, null, 2));
  const failed = report.items.filter((item) => item.status !== "SUCCEEDED");
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} batch20 videos did not succeed; inspect the report before retrying`,
    );
  }
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
