/**
 * Real-provider acceptance: 10 independent 15-second videos through the
 * persisted batch pipeline, using deterministic random 15s templates.
 *
 * The run is intentionally resumable. Every item has a stable idempotency key,
 * and the JSON report is updated after each mutation/poll.
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
import {
  getShuyuPrices,
  getShuyuHealth,
  isAuditedShuyuVideoPlan,
} from "@/lib/providers/shuyu";

loadEnvConfig(process.cwd());

// This command is intentionally a paid-provider acceptance harness. Keep the
// ordinary developer environment safe-by-default, but make this process's
// routing decision explicit so a local VIDEO_ENGINE_MOCK=true cannot silently
// turn the acceptance run into mock output or block the audited buddy route.
process.env.VIDEO_ENGINE_MOCK = "false";
process.env.VIDEO_PROVIDER = "shuyu";

const RUN_KEY = "real-acceptance-20260718-backend-v3";
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-video-acceptance");
const REPORT_PATH = resolve(OUTPUT_DIR, "backend-10-v3.json");
const VIDEO_DIR = resolve(OUTPUT_DIR, "backend-videos-v3");
const POLL_MS = 20_000;
const MAX_WAIT_MS = 60 * 60_000;
const WAIT_FOR_PROVIDER = ["1", "true", "yes"].includes(
  (process.env.REAL_ACCEPTANCE_WAIT_FOR_PROVIDER ?? "").trim().toLowerCase(),
);
const PROVIDER_WAIT_POLL_MS = 30_000;
const PROVIDER_WAIT_MAX_MS = 6 * 60 * 60_000;

const SOURCE_PATHS = [
  "/Users/evan/Downloads/2024-11-14 14.10.56.jpg",
  "/Users/evan/Downloads/2024-11-14 14.10.46.jpg",
  "/Users/evan/Downloads/2024-03-14 11.55.01.jpeg",
  "/Users/evan/Downloads/2024-01-31 10.39.03.jpeg",
  "/Users/evan/Downloads/2026-04-29 16.04.00.jpg",
  "/Users/evan/Downloads/2024-03-07 15.33.02.jpeg",
  "/Users/evan/Downloads/2024-01-23 14.47.09.jpeg",
] as const;

const CANDIDATE_TEMPLATE_SLUGS = [
  "furniture-room-anchor",
  "before-after-reversal",
  "same-frame-comparison",
  "one-action-proof",
  "feature-detail-triad",
  "lifestyle-use-demo",
  "ugc-handheld-review",
] as const;

type ReportItem = {
  index: number;
  idempotencyKey: string;
  templateId: string;
  templateSlug: string;
  templateNameZh: string;
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
  purpose: "backend-10x15s-real-provider-acceptance";
  providerRoute: "buddy";
  requestedCount: 10;
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

function deterministicTemplateOrder<T extends { slug: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftHash = createHash("sha256")
      .update(`${RUN_KEY}:${left.slug}`)
      .digest("hex");
    const rightHash = createHash("sha256")
      .update(`${RUN_KEY}:${right.slug}`)
      .digest("hex");
    return leftHash.localeCompare(rightHash);
  });
}

async function waitForAuditedVideoPlan(): Promise<void> {
  if (!WAIT_FOR_PROVIDER) return;
  const deadline = Date.now() + PROVIDER_WAIT_MAX_MS;
  while (Date.now() < deadline) {
    try {
      const [, prices] = await Promise.all([
        getShuyuHealth(),
        getShuyuPrices(),
      ]);
      const audited = prices.data.find(isAuditedShuyuVideoPlan);
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          phase: "provider-plan-wait",
          visiblePlans: prices.data.map((plan) => plan.plan_id),
          auditedPlanAvailable: Boolean(audited),
        }),
      );
      if (audited) return;
    } catch (error) {
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          phase: "provider-plan-wait",
          error: error instanceof Error ? error.message : "price audit failed",
        }),
      );
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, PROVIDER_WAIT_POLL_MS),
    );
  }
  throw new Error("Timed out waiting for the audited Shuyu video plan");
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
    const path = resolve(VIDEO_DIR, `backend-${String(item.index).padStart(2, "0")}.mp4`);
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
  await waitForAuditedVideoPlan();
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
    return params.duration === 15 && Number(images.min) <= sourceAssets.length;
  });
  if (compatible.length !== CANDIDATE_TEMPLATE_SLUGS.length) {
    throw new Error(
      `Expected ${CANDIDATE_TEMPLATE_SLUGS.length} compatible templates, found ${compatible.length}`,
    );
  }
  const templateOrder = deterministicTemplateOrder(compatible);
  const report: Report = existing ?? {
    runKey: RUN_KEY,
    purpose: "backend-10x15s-real-provider-acceptance",
    providerRoute: "buddy",
    requestedCount: 10,
    durationSec: 15,
    startedAt: new Date().toISOString(),
    sourceAssets,
    templateOrder: templateOrder.map((template) => template.slug),
    items: [],
  };
  report.sourceAssets = sourceAssets;
  // A prior fail-closed availability check may have produced a resumable
  // zero-item report. Start the benchmark clock only when this run can create
  // its first real batch, so provider downtime is not counted as generation
  // latency.
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
  for (let index = 1; index <= report.requestedCount; index += 1) {
    const template = templateOrder[(index - 1) % templateOrder.length];
    const idempotencyKey = `${RUN_KEY}:${index}`;
    const batch = await createBatchJob({
      userId: user.id,
      templateId: template.id,
      templateVersion: template.version,
      images: sourceAssets.map((asset) => ({ id: asset.id, url: asset.blobUrl })),
      requestedCount: 1,
      productName: "Custom plantation shutters / 定制百叶窗",
      idempotencyKey,
      videoRouteId: "buddy",
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
      batchId: batch.id,
      ...(priorIndex >= 0 ? report.items[priorIndex] : {}),
    };
    if (priorIndex >= 0) report.items[priorIndex] = item;
    else report.items.push(item);
    writeReport(report);
  }

  // Paid-provider canary: submit only item 1 first. A provider-confirmed
  // rejection stops the run before the remaining nine requests are sent.
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
    throw new Error(`Paid-provider canary was not accepted: ${canary.error ?? canary.status}`);
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    for (const item of report.items) {
      const current = await getBatchStatus(item.batchId, user.id);
      if (!isTerminalBatchStatus(current.status)) {
        await processBatchTick(item.batchId);
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
  if (!terminal) throw new Error(`Backend run timed out; resume with the same command`);
  report.finishedAt = new Date().toISOString();
  report.elapsedMs =
    new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  writeReport(report);
  await downloadCompletedVideos(report);
  console.log(JSON.stringify({ reportPath: REPORT_PATH, elapsedMs: report.elapsedMs }, null, 2));
  const failed = report.items.filter((item) => item.status !== "SUCCEEDED");
  if (failed.length > 0) {
    throw new Error(`${failed.length} backend videos did not succeed; inspect the report before retrying`);
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
