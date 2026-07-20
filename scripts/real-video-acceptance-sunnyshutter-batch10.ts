/**
 * SunnyShutter 电商专用模版 · 10 条批量验收骨架。
 *
 * 全部使用 `sunnyshutter-commerce-cta-*` 模版族（钩子 → 冲突/对比 → 回归产品 +
 * 安全镜头硬闸 + CEO 风格车道）。11 个变体轮转出 10 条。
 *
 * 默认 DRY RUN（只打印计划 + 渲染 prompt，不烧钱）。
 * 充值 / Shuyu 视频可用后：
 *   ACCEPTANCE_SUBMIT=1 npx tsx --env-file=.env.local scripts/real-video-acceptance-sunnyshutter-batch10.ts
 *
 * Spec: docs/acceptance/shutter-safe-shot-policy.md §11–12
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
import { seedBatchStyleTemplates } from "@/lib/services/style-template-service";
import { VOLCENGINE_CN_ARK_BASE_URL } from "@/lib/config/seedance-runtime";
import { renderBatchTemplatePrompt } from "@/lib/video-generation/batch-style-templates";
import {
  SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY,
  SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS,
  pickSunnyShutterCommerceVariant,
} from "@/lib/video-generation/sunnyshutter-commerce-template";

loadEnvConfig(process.cwd(), true);

const SUBMIT = process.env.ACCEPTANCE_SUBMIT === "1";
const RUN_KEY =
  process.env.REAL_ACCEPTANCE_RUN_KEY?.trim() ||
  "real-acceptance-sunnyshutter-commerce-batch10-v1";
const ITEM_COUNT = 10;
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-video-acceptance");
const REPORT_PATH = resolve(OUTPUT_DIR, "sunnyshutter-commerce-batch10.json");
const VIDEO_DIR = resolve(OUTPUT_DIR, "sunnyshutter-commerce-batch10-videos");
const IMAGES_PER_ITEM = 4;
const TICK_SPACING_MS = 1_200;
const POLL_MS = 20_000;
const MAX_WAIT_MS = 90 * 60_000;

const SOURCE_PATHS = [
  "/Users/evan/Downloads/2024-11-14 14.10.56.jpg",
  "/Users/evan/Downloads/2024-11-14 14.10.46.jpg",
  "/Users/evan/Downloads/2024-03-14 11.55.01.jpeg",
  "/Users/evan/Downloads/2024-01-31 10.39.03.jpeg",
  "/Users/evan/Downloads/2026-04-29 16.04.00.jpg",
  "/Users/evan/Downloads/2024-03-07 15.33.02.jpeg",
  "/Users/evan/Downloads/2024-01-23 14.47.09.jpeg",
] as const;

const COMMERCE_SLUGS = SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS.map((s) => s.slug);

type ReportItem = {
  index: number;
  idempotencyKey: string;
  templateSlug: string;
  plotVariantId: string;
  templateId?: string;
  imageIds: string[];
  batchId?: string;
  videoJobId?: string;
  externalJobId?: string | null;
  status?: string;
  outputVideoUrl?: string | null;
  localPath?: string | null;
  promptPreview?: string;
  error?: string | null;
};

type Report = {
  runKey: string;
  purpose: "sunnyshutter-commerce-cta-batch10";
  templateFamily: typeof SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY;
  providerRoute: "volcengine_cn_legacy";
  dryRun: boolean;
  requestedCount: number;
  durationSec: 15;
  startedAt: string;
  finishedAt?: string;
  sourceAssets: Array<{ id: string; localPath: string; blobUrl: string }>;
  items: ReportItem[];
};

function hashOf(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

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

function mimeType(path: string): "image/jpeg" {
  const extension = extname(path).toLowerCase();
  if (extension !== ".jpg" && extension !== ".jpeg") {
    throw new Error(`Unsupported source image: ${path}`);
  }
  return "image/jpeg";
}

async function uploadAssets(
  existing: Report | null,
): Promise<Report["sourceAssets"]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for submit mode");
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

function buildDryRunAssets(): Report["sourceAssets"] {
  return SOURCE_PATHS.map((localPath, index) => ({
    id: `${RUN_KEY}-source-${index + 1}`,
    localPath,
    blobUrl: `https://example.invalid/dry-run/${encodeURIComponent(basename(localPath))}`,
  }));
}

function writeReport(report: Report): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(
    [
      `SunnyShutter commerce batch10 · family=${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}`,
      `mode=${SUBMIT ? "SUBMIT (paid)" : "DRY RUN (no provider calls)"}`,
      `runKey=${RUN_KEY}`,
      `variants=${COMMERCE_SLUGS.join(", ")}`,
    ].join("\n"),
  );

  const existing = existsSync(REPORT_PATH)
    ? (JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report)
    : null;

  if (SUBMIT) {
    process.env.VIDEO_ENGINE_MOCK = "false";
    process.env.VIDEO_PROVIDER = "byteplus";
    process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
    process.env.ARK_BASE_URL = VOLCENGINE_CN_ARK_BASE_URL;
    process.env.ARK_VIDEO_MODEL = "doubao-seedance-2-0-260128";
  }

  const sourceAssets = SUBMIT
    ? await uploadAssets(existing)
    : (existing?.sourceAssets?.length ? existing.sourceAssets : buildDryRunAssets());

  const seedBySlug = new Map(
    SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS.map((seed) => [seed.slug, seed]),
  );

  const items: ReportItem[] = [];
  for (let index = 1; index <= ITEM_COUNT; index += 1) {
    const variant = pickSunnyShutterCommerceVariant(index);
    const seed = seedBySlug.get(variant.slug);
    if (!seed) throw new Error(`Missing seed for ${variant.slug}`);
    const itemImages = imagesForItem(index, sourceAssets);
    const promptPreview = renderBatchTemplatePrompt({
      promptSkeleton: seed.promptSkeleton,
      productName: "Custom plantation shutters / 定制实木百叶窗 · SunnyShutter",
      imageUrls: itemImages.map((asset) => asset.blobUrl),
    }).slice(0, 480);

    items.push({
      index,
      idempotencyKey: `${RUN_KEY}:${index}`,
      templateSlug: variant.slug,
      plotVariantId: variant.id,
      imageIds: itemImages.map((asset) => asset.id),
      promptPreview,
    });

    console.log(
      `#${String(index).padStart(2, "0")} ${variant.slug} · ${variant.nameZh} · images=${itemImages.length}`,
    );
  }

  const report: Report = {
    runKey: RUN_KEY,
    purpose: "sunnyshutter-commerce-cta-batch10",
    templateFamily: SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY,
    providerRoute: "volcengine_cn_legacy",
    dryRun: !SUBMIT,
    requestedCount: ITEM_COUNT,
    durationSec: 15,
    startedAt: new Date().toISOString(),
    sourceAssets,
    items,
  };
  writeReport(report);

  if (!SUBMIT) {
    console.log(
      `\nDRY RUN done. Plan written to ${REPORT_PATH}\n` +
        "When ARK is topped up (or Shuyu video is live), re-run with ACCEPTANCE_SUBMIT=1.",
    );
    return;
  }

  await seedBatchStyleTemplates();
  const templates = await db.styleTemplate.findMany({
    where: {
      slug: { in: COMMERCE_SLUGS },
      status: StyleTemplateStatus.ACTIVE,
    },
  });
  if (templates.length !== COMMERCE_SLUGS.length) {
    throw new Error(
      `Expected ${COMMERCE_SLUGS.length} ACTIVE commerce templates, found ${templates.length}. Run seedBatchStyleTemplates.`,
    );
  }
  const templateBySlug = new Map(templates.map((row) => [row.slug, row]));

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const user = await db.adminUser.findFirst({
    where: adminEmail ? { email: adminEmail } : { role: "SUPER_ADMIN" },
  });
  if (!user) throw new Error("No acceptance user found");

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

  for (const item of report.items) {
    const template = templateBySlug.get(item.templateSlug);
    if (!template) throw new Error(`Template not in DB: ${item.templateSlug}`);
    const itemImages = imagesForItem(item.index, sourceAssets);
    const batch = await createBatchJob({
      userId: user.id,
      templateId: template.id,
      templateVersion: template.version,
      images: itemImages.map((asset) => ({ id: asset.id, url: asset.blobUrl })),
      requestedCount: 1,
      productName: "Custom plantation shutters / 定制实木百叶窗 · SunnyShutter",
      idempotencyKey: item.idempotencyKey,
      videoRouteId: "volcengine_cn_legacy",
      isInternalStaff: true,
    });
    await authorizeBatchQuotaForSession(session, batch.id);
    item.templateId = template.id;
    item.batchId = batch.id;
    writeReport(report);
  }

  // Canary: tick item 1 first; stop the rest if provider rejects.
  const canary = report.items[0]!;
  await processBatchTick(canary.batchId!);
  const canaryAfter = await getBatchStatus(canary.batchId!, user.id);
  const canaryJob = canaryAfter.videoJobs[0];
  canary.status = canaryAfter.status;
  canary.videoJobId = canaryJob?.id;
  canary.externalJobId = canaryJob?.externalJobId ?? null;
  canary.error = canaryJob?.errorMessage ?? null;
  writeReport(report);

  if (
    canaryAfter.status === "FAILED" ||
    String(canaryJob?.errorMessage ?? "").includes("AccountOverdue")
  ) {
    throw new Error(
      `Canary failed — aborting remaining 9. status=${canaryAfter.status} error=${canary.error}`,
    );
  }

  for (const item of report.items.slice(1)) {
    await sleep(TICK_SPACING_MS);
    await processBatchTick(item.batchId!);
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    let allTerminal = true;
    for (const item of report.items) {
      const status = await getBatchStatus(item.batchId!, user.id);
      const job = status.videoJobs[0];
      item.status = status.status;
      item.videoJobId = job?.id;
      item.externalJobId = job?.externalJobId ?? null;
      item.outputVideoUrl = job?.outputVideoUrl ?? null;
      item.error = job?.errorMessage ?? null;
      if (!isTerminalBatchStatus(status.status)) allTerminal = false;
      if (!isTerminalBatchStatus(status.status)) {
        await processBatchTick(item.batchId!);
      }
    }
    writeReport(report);
    if (allTerminal) break;
    await sleep(POLL_MS);
  }

  mkdirSync(VIDEO_DIR, { recursive: true });
  for (const item of report.items) {
    if (!item.outputVideoUrl) continue;
    const path = resolve(
      VIDEO_DIR,
      `ss-commerce-${String(item.index).padStart(2, "0")}-${item.plotVariantId}.mp4`,
    );
    if (!existsSync(path)) {
      const response = await fetch(item.outputVideoUrl);
      if (!response.ok) {
        throw new Error(`download ${item.index} failed (${response.status})`);
      }
      writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    }
    item.localPath = path;
  }

  report.finishedAt = new Date().toISOString();
  report.dryRun = false;
  writeReport(report);
  console.log(`SUBMIT done. Report: ${REPORT_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
