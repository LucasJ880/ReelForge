/**
 * SunnyShutter 电商专用 · 10×15s 锁定流水线验收。
 *
 * 硬锁流程（同行高质量路径 / CEO 标准）:
 *   1) Shuyu GPT Image 2 故事版（2 帧：钩子 + 回归产品）
 *   2) storyboard-lock 硬闸
 *   3) Shuyu Seedance I2V 15s（故事版 + 产品参考图）
 *   4) 品牌包装：左上角 logo + 锁定尾卡
 *
 * 默认 DRY RUN。提交：
 *   ACCEPTANCE_SUBMIT=1 npm run acceptance:sunnyshutter:batch10:submit
 *
 * Spec: docs/acceptance/shutter-safe-shot-policy.md
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { list } from "@vercel/blob";
import {
  SHUYU_IMAGE_PLAN_ID,
  SHUYU_VIDEO_FAST_PLAN_ID,
  SHUYU_VIDEO_PLAN_ID,
  getShuyuBalance,
} from "@/lib/providers/shuyu";
import {
  SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY,
  SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS,
  pickSunnyShutterCommerceVariant,
} from "@/lib/video-generation/sunnyshutter-commerce-template";
import {
  SUNNYSHUTTER_LOCKED_PIPELINE_ID,
  SUNNYSHUTTER_PIPELINE_DURATION_SEC,
  buildSunnyShutterI2VPlan,
  generateSunnyShutterStoryboard,
  pollShuyuTaskUntilDone,
  runSunnyShutterI2VWithFailover,
} from "@/lib/video-generation/sunnyshutter-image2-pipeline";
import type { Image2StoryboardArtifact } from "@/lib/video-generation/storyboard-lock";
import { applyBrandOverlay } from "@/lib/video-generation/brand-overlay-renderer";
import { trimVideoTail } from "@/lib/video-generation/tail-trim";
import { renderBrandEndCard } from "@/lib/video-generation/brand-end-card-renderer";
import { runFfmpegNormalizeAndConcat } from "@/lib/services/stitch-service";
import {
  SUNNYSHUTTER_END_CARD_COPY,
  SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT,
  SUNNYSHUTTER_LOGO_RELATIVE,
  applySunnyShutterBrandPack,
  sunnyShutterLogoFileUrl,
  sunnyShutterLogoOverlayConfig,
} from "@/lib/video-generation/sunnyshutter-brand-pack";
import type { BrandPackagingPlan } from "@/types/video-generation";

loadEnvConfig(process.cwd(), true);

const SUBMIT = process.env.ACCEPTANCE_SUBMIT === "1";
/** Fast VIP (video-plan-03, 88pts/sec) is default for acceptance speed. Set SUNNYSHUTTER_VIDEO_FAST=0 for audited plan-02. */
const PREFER_FAST_VIP = process.env.SUNNYSHUTTER_VIDEO_FAST !== "0";
const RUN_KEY =
  process.env.REAL_ACCEPTANCE_RUN_KEY?.trim() ||
  "real-acceptance-sunnyshutter-image2-batch10-v1";
const ITEM_COUNT = 10;
const PRODUCT_NAME =
  "Custom plantation shutters / 定制实木百叶窗 · SunnyShutter";
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-video-acceptance");
const REPORT_PATH = resolve(OUTPUT_DIR, "sunnyshutter-image2-batch10.json");
const VIDEO_DIR = resolve(OUTPUT_DIR, "sunnyshutter-image2-batch10-videos");
const BRANDED_DIR = resolve(OUTPUT_DIR, "sunnyshutter-image2-batch10-branded");
const LOGO_PATH = resolve(process.cwd(), SUNNYSHUTTER_LOGO_RELATIVE);
const IMAGES_PER_ITEM = 4;
const TICK_SPACING_MS = 1_500;

/** Stable Blob prefix from prior acceptance uploads (local Downloads may be empty). */
const SOURCE_BLOB_PREFIX =
  "real-video-acceptance/real-acceptance-20260718-backend-v1/";

type SourceAsset = { id: string; pathname: string; blobUrl: string };

type ReportItem = {
  index: number;
  idempotencyKey: string;
  templateSlug: string;
  plotVariantId: string;
  styleLane: string;
  imageIds: string[];
  productImageUrls: string[];
  storyboard?: Image2StoryboardArtifact;
  videoPlanId?: string;
  externalJobId?: string | null;
  status?: string;
  outputVideoUrl?: string | null;
  localPath?: string | null;
  brandedLocalPath?: string | null;
  brandedBlobUrl?: string | null;
  promptPreview?: string;
  error?: string | null;
  storyboardStartedAt?: string;
  storyboardFinishedAt?: string;
  videoStartedAt?: string;
  videoFinishedAt?: string;
  elapsedMs?: number;
};

type Report = {
  runKey: string;
  purpose: "sunnyshutter-image2-storyboard-batch10";
  pipelineId: typeof SUNNYSHUTTER_LOCKED_PIPELINE_ID;
  templateFamily: typeof SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY;
  providerRoute: "shuyu";
  imagePlanId: string;
  videoPlanId: string;
  preferFastVip: boolean;
  dryRun: boolean;
  requestedCount: number;
  durationSec: typeof SUNNYSHUTTER_PIPELINE_DURATION_SEC;
  startedAt: string;
  finishedAt?: string;
  sourceAssets: SourceAsset[];
  items: ReportItem[];
};

function hashOf(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function imagesForItem(index: number, assets: SourceAsset[]): SourceAsset[] {
  const shuffled = [...assets].sort((left, right) =>
    hashOf(`${RUN_KEY}:item-${index}:${left.id}`).localeCompare(
      hashOf(`${RUN_KEY}:item-${index}:${right.id}`),
    ),
  );
  return shuffled.slice(0, IMAGES_PER_ITEM);
}

function writeReport(report: Report): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function resolveSourceAssets(
  existing: Report | null,
): Promise<SourceAsset[]> {
  if (existing?.sourceAssets?.length) return existing.sourceAssets;
  if (!process.env.BLOB_READ_WRITE_TOKEN && SUBMIT) {
    throw new Error("BLOB_READ_WRITE_TOKEN required to resolve product sources");
  }
  if (!SUBMIT) {
    return Array.from({ length: 7 }, (_, index) => ({
      id: `${RUN_KEY}-source-${index + 1}`,
      pathname: `${SOURCE_BLOB_PREFIX}source-${index + 1}.jpg`,
      blobUrl: `https://example.invalid/dry-run/source-${index + 1}.jpg`,
    }));
  }
  const listed = await list({
    prefix: SOURCE_BLOB_PREFIX,
    limit: 50,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  const images = listed.blobs
    .filter((blob) => /\.(jpe?g|png)$/i.test(blob.pathname))
    .sort((a, b) => a.pathname.localeCompare(b.pathname));
  if (images.length < 4) {
    throw new Error(
      `Need ≥4 product images under ${SOURCE_BLOB_PREFIX}, found ${images.length}`,
    );
  }
  return images.map((blob, index) => ({
    id: `${RUN_KEY}-source-${index + 1}`,
    pathname: blob.pathname,
    blobUrl: blob.url,
  }));
}

function endCardPlan(language: "en" | "zh"): BrandPackagingPlan {
  const copy = SUNNYSHUTTER_END_CARD_COPY[language];
  return applySunnyShutterBrandPack(
    {
      mode: "auto_end_card",
      logoAssetId: null,
      endCardDurationSeconds: copy.endCardDurationSeconds,
      brandName: copy.brandName,
      slogan: copy.slogan,
      cta: copy.cta,
      contactLines: [...copy.contactLines],
      website: copy.website,
      renderStrategy: "render_ffmpeg_overlay",
      warnings: [],
    },
    {
      clientLockProfileId: "sunnyshutter",
      brandName: copy.brandName,
      language,
      aspectRatio: "9:16",
    },
  );
}

async function brandOne(args: {
  index: number;
  sourcePath: string;
  language: "en" | "zh";
  endCardUrl: string;
}): Promise<{ localPath: string; blobUrl: string }> {
  if (!existsSync(LOGO_PATH)) throw new Error(`logo missing: ${LOGO_PATH}`);
  mkdirSync(BRANDED_DIR, { recursive: true });
  const logoCfg = sunnyShutterLogoOverlayConfig();
  // Seedance 常在最后 1s 幻觉假名片 — 拼真尾卡前先裁掉尾部。
  const trimmedPath = await trimVideoTail(args.sourcePath, {
    tailSeconds: 0.8,
  });
  const overlay = await applyBrandOverlay({
    sourceVideo: trimmedPath,
    logo: LOGO_PATH,
    placement: SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT,
    durationMode: logoCfg.durationMode,
    logoWidthRatio: logoCfg.logoWidthRatio,
    opacity: logoCfg.opacity,
    marginPx: logoCfg.marginPx,
    outputDir: BRANDED_DIR,
  });
  const brandedUrl = await runFfmpegNormalizeAndConcat({
    finalVideoId: `${RUN_KEY}-branded-${args.index}`,
    aspectRatio: "9:16",
    clips: [
      { url: overlay.outputUrl, intendedDurationSec: null, trimToFit: false },
      { url: args.endCardUrl, intendedDurationSec: 3, trimToFit: true },
    ],
  });
  const localPath = resolve(
    BRANDED_DIR,
    `ss-image2-${String(args.index).padStart(2, "0")}-branded.mp4`,
  );
  const response = await fetch(brandedUrl);
  if (!response.ok) {
    throw new Error(`download branded failed (${response.status})`);
  }
  writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
  return { localPath, blobUrl: brandedUrl };
}

async function processItem(
  item: ReportItem,
  report: Report,
): Promise<void> {
  if (item.status === "SUCCEEDED" && item.localPath && existsSync(item.localPath)) {
    console.log(`#${item.index} skip (already SUCCEEDED)`);
    return;
  }

  const itemStartedMs = Date.now();
  try {
    if (!item.storyboard?.frames?.length) {
      console.log(`#${item.index} storyboard (Image2)…`);
      item.storyboardStartedAt = new Date().toISOString();
      item.storyboard = await generateSunnyShutterStoryboard({
        index1Based: item.index,
        productImageUrls: item.productImageUrls,
        purpose: `${RUN_KEY}:item-${item.index}`,
        providerRequestKeyPrefix: `${RUN_KEY}:${item.index}`,
        imagePlanId: report.imagePlanId,
      });
      item.storyboardFinishedAt = new Date().toISOString();
      writeReport(report);
    }

    const i2v = buildSunnyShutterI2VPlan({
      index1Based: item.index,
      productName: PRODUCT_NAME,
      productImageUrls: item.productImageUrls,
      storyboard: item.storyboard!,
      preferFastVip: report.preferFastVip,
    });
    item.videoPlanId = i2v.videoPlanId;
    item.promptPreview = i2v.prompt.slice(0, 480);
    item.videoStartedAt = item.videoStartedAt ?? new Date().toISOString();

    if (item.outputVideoUrl && item.status === "SUCCEEDED") {
      // resume download only
    } else if (
      item.externalJobId &&
      item.status === "PROCESSING" &&
      // Only resume poll when the stuck job is already on the preferred plan family.
      // Old slow VIP (plan-02) jobs are abandoned in favor of Fast VIP.
      String(item.videoPlanId ?? "").startsWith("video-plan-0") &&
      (report.preferFastVip
        ? ["video-plan-03", "video-plan-05"].includes(String(item.videoPlanId))
        : item.videoPlanId === i2v.videoPlanId)
    ) {
      console.log(
        `#${item.index} resume poll ${item.externalJobId} on ${item.videoPlanId}…`,
      );
      try {
        const done = await pollShuyuTaskUntilDone(item.externalJobId, {
          label: `video#${item.index}`,
          pollMs: 6_000,
          maxWaitMs: 15 * 60_000,
        });
        item.outputVideoUrl = done.url;
        item.status = "SUCCEEDED";
      } catch {
        console.log(`#${item.index} prior Fast job failed — failover…`);
        item.externalJobId = null;
        const done = await runSunnyShutterI2VWithFailover({
          plan: i2v,
          providerRequestKey: `${item.idempotencyKey}:video`,
          label: `video#${item.index}`,
          pollMs: 6_000,
          maxWaitMs: 20 * 60_000,
        });
        item.externalJobId = done.taskId;
        item.videoPlanId = done.planId;
        item.outputVideoUrl = done.url;
        item.status = "SUCCEEDED";
      }
      writeReport(report);
    } else {
      console.log(`#${item.index} submit I2V with plan failover…`);
      const done = await runSunnyShutterI2VWithFailover({
        plan: i2v,
        providerRequestKey: `${item.idempotencyKey}:video`,
        label: `video#${item.index}`,
        pollMs: 8_000,
        maxWaitMs: 35 * 60_000,
      });
      item.externalJobId = done.taskId;
      item.videoPlanId = done.planId;
      item.outputVideoUrl = done.url;
      item.status = "SUCCEEDED";
      writeReport(report);
    }

    mkdirSync(VIDEO_DIR, { recursive: true });
    const localPath = resolve(
      VIDEO_DIR,
      `ss-image2-${String(item.index).padStart(2, "0")}-${item.plotVariantId}.mp4`,
    );
    if (!existsSync(localPath) && item.outputVideoUrl) {
      const response = await fetch(item.outputVideoUrl);
      if (!response.ok) {
        throw new Error(`download failed (${response.status})`);
      }
      writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
    }
    item.localPath = localPath;
    item.videoFinishedAt = new Date().toISOString();
    item.elapsedMs = Date.now() - itemStartedMs;
    writeReport(report);
    console.log(
      `#${item.index} OK → ${basename(localPath)} · plan=${item.videoPlanId} · ${(item.elapsedMs / 1000).toFixed(0)}s`,
    );
  } catch (error) {
    item.status = "FAILED";
    item.error = error instanceof Error ? error.message : String(error);
    item.elapsedMs = Date.now() - itemStartedMs;
    writeReport(report);
    throw error;
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const videoPlanId = PREFER_FAST_VIP
    ? SHUYU_VIDEO_FAST_PLAN_ID
    : SHUYU_VIDEO_PLAN_ID;

  console.log(
    [
      `SunnyShutter Image2→I2V batch10`,
      `pipeline=${SUNNYSHUTTER_LOCKED_PIPELINE_ID}`,
      `mode=${SUBMIT ? "SUBMIT (paid)" : "DRY RUN"}`,
      `runKey=${RUN_KEY}`,
      `imagePlan=${SHUYU_IMAGE_PLAN_ID}`,
      `videoPlan=${videoPlanId}${PREFER_FAST_VIP ? " (Fast VIP 88pts/sec)" : " (audited 900/gen)"}`,
      `duration=${SUNNYSHUTTER_PIPELINE_DURATION_SEC}s × ${ITEM_COUNT}`,
      `variants=${SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS.length}`,
    ].join("\n"),
  );

  const existing = existsSync(REPORT_PATH)
    ? (JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report)
    : null;

  const sourceAssets = await resolveSourceAssets(existing);

  const items: ReportItem[] = [];
  for (let index = 1; index <= ITEM_COUNT; index += 1) {
    const variant = pickSunnyShutterCommerceVariant(index);
    const itemImages = imagesForItem(index, sourceAssets);
    const prior = existing?.items.find((row) => row.index === index);
    items.push({
      index,
      idempotencyKey: `${RUN_KEY}:${index}`,
      templateSlug: variant.slug,
      plotVariantId: variant.id,
      styleLane: variant.styleLane,
      imageIds: itemImages.map((asset) => asset.id),
      productImageUrls: itemImages.map((asset) => asset.blobUrl),
      storyboard: prior?.storyboard,
      videoPlanId: prior?.videoPlanId,
      externalJobId: prior?.externalJobId ?? null,
      status: prior?.status,
      outputVideoUrl: prior?.outputVideoUrl ?? null,
      localPath: prior?.localPath ?? null,
      brandedLocalPath: prior?.brandedLocalPath ?? null,
      brandedBlobUrl: prior?.brandedBlobUrl ?? null,
      error: prior?.error ?? null,
      promptPreview: prior?.promptPreview,
    });
    console.log(
      `#${String(index).padStart(2, "0")} ${variant.slug} · ${variant.nameZh} · ${variant.styleLane}`,
    );
  }

  const report: Report = {
    runKey: RUN_KEY,
    purpose: "sunnyshutter-image2-storyboard-batch10",
    pipelineId: SUNNYSHUTTER_LOCKED_PIPELINE_ID,
    templateFamily: SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY,
    providerRoute: "shuyu",
    imagePlanId: SHUYU_IMAGE_PLAN_ID,
    videoPlanId,
    preferFastVip: PREFER_FAST_VIP,
    dryRun: !SUBMIT,
    requestedCount: ITEM_COUNT,
    durationSec: SUNNYSHUTTER_PIPELINE_DURATION_SEC,
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    sourceAssets,
    items,
  };
  writeReport(report);

  if (!SUBMIT) {
    console.log(
      `\nDRY RUN done → ${REPORT_PATH}\n` +
        "Submit with ACCEPTANCE_SUBMIT=1 (Shuyu Image2 storyboard → 15s I2V).",
    );
    return;
  }

  const balance = await getShuyuBalance();
  console.log(`Shuyu balance: ${balance.available_points} pts`);

  // Canary item 1 first
  await processItem(report.items[0]!, report);

  for (const item of report.items.slice(1)) {
    await sleep(TICK_SPACING_MS);
    try {
      await processItem(item, report);
    } catch (error) {
      console.error(
        `#${item.index} failed — continuing remaining. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Second pass: retry busy-line failures (common on Image2 / Fast VIP).
  const retryables = report.items.filter((item) => item.status === "FAILED");
  if (retryables.length > 0) {
    console.log(`\nRetry pass for ${retryables.length} failed item(s)…`);
    for (const item of retryables) {
      item.status = undefined;
      item.error = null;
      item.externalJobId = null;
      item.outputVideoUrl = null;
      // Keep storyboard if already generated.
      await sleep(5_000);
      try {
        await processItem(item, report);
      } catch (error) {
        console.error(
          `#${item.index} retry failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  // Brand packaging for successes
  if (!existsSync(LOGO_PATH)) {
    console.warn(`skip branding — logo missing at ${LOGO_PATH}`);
  } else {
    const endCardEn = await renderBrandEndCard({
      briefId: `${RUN_KEY}-end-en`,
      plan: endCardPlan("en"),
      aspectRatio: "9:16",
      logoUrl: sunnyShutterLogoFileUrl(),
    });
    const endCardZh = await renderBrandEndCard({
      briefId: `${RUN_KEY}-end-zh`,
      plan: endCardPlan("zh"),
      aspectRatio: "9:16",
      logoUrl: sunnyShutterLogoFileUrl(),
    });
    if (!endCardEn?.url || !endCardZh?.url) {
      throw new Error("end card render failed");
    }
    for (const item of report.items) {
      if (item.status !== "SUCCEEDED" || !item.localPath) continue;
      if (item.brandedLocalPath && existsSync(item.brandedLocalPath)) continue;
      const language = item.index % 5 === 0 ? "zh" : "en";
      try {
        const branded = await brandOne({
          index: item.index,
          sourcePath: item.localPath,
          language,
          endCardUrl: language === "zh" ? endCardZh.url : endCardEn.url,
        });
        item.brandedLocalPath = branded.localPath;
        item.brandedBlobUrl = branded.blobUrl;
        writeReport(report);
        console.log(`#${item.index} branded → ${basename(branded.localPath)}`);
      } catch (error) {
        item.error = [
          item.error,
          `branding: ${error instanceof Error ? error.message : String(error)}`,
        ]
          .filter(Boolean)
          .join(" | ");
        writeReport(report);
        console.error(`#${item.index} branding failed: ${item.error}`);
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  report.dryRun = false;
  writeReport(report);

  const ok = report.items.filter((item) => item.status === "SUCCEEDED").length;
  const branded = report.items.filter((item) => item.brandedLocalPath).length;
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        succeeded: ok,
        branded,
        failed: report.items
          .filter((item) => item.status === "FAILED")
          .map((item) => ({ index: item.index, error: item.error })),
      },
      null,
      2,
    ),
  );
  if (ok < ITEM_COUNT) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
