/**
 * SunnyShutter SHADE batch · 10×15s (Plan A: ~6 roller + 2 zebra + 2 sheer).
 *
 * Locked quality path (lessons from shutter batch):
 *   Image2 3-frame storyboard (same person/room) → Fast VIP I2V →
 *   top-left logo + English business-card end card.
 *
 *   ACCEPTANCE_SUBMIT=1 npm run acceptance:sunnyshutter:shade:batch10:submit
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { put } from "@vercel/blob";
import { getShuyuBalance } from "@/lib/providers/shuyu";
import {
  SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY,
  pickSunnyShutterShadeVariant,
} from "@/lib/video-generation/sunnyshutter-shade-template";
import {
  SUNNYSHUTTER_SHADE_PIPELINE_ID,
  generateShadeStoryboard,
  runShadeI2V,
} from "@/lib/video-generation/sunnyshutter-shade-pipeline";
import type { Image2StoryboardArtifact } from "@/lib/video-generation/storyboard-lock";
import { applyBrandOverlay } from "@/lib/video-generation/brand-overlay-renderer";
import { renderBrandEndCard } from "@/lib/video-generation/brand-end-card-renderer";
import { runFrameTextQa } from "@/lib/video-generation/frame-qa";
import { trimVideoTail } from "@/lib/video-generation/tail-trim";
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
const RUN_KEY =
  process.env.REAL_ACCEPTANCE_RUN_KEY?.trim() ||
  "real-acceptance-sunnyshutter-shade-batch10-v1";
const ITEM_COUNT = 10;
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-video-acceptance");
/** 允许 v2/v3 复跑与旧批次并存，报告/产物目录互不覆盖 */
const OUT_SUFFIX = process.env.REAL_ACCEPTANCE_OUT_SUFFIX?.trim() ?? "";
const REPORT_PATH = resolve(
  OUTPUT_DIR,
  `sunnyshutter-shade-batch10${OUT_SUFFIX}.json`,
);
const VIDEO_DIR = resolve(
  OUTPUT_DIR,
  `sunnyshutter-shade-batch10${OUT_SUFFIX}-videos`,
);
const BRANDED_DIR = resolve(
  OUTPUT_DIR,
  `sunnyshutter-shade-batch10${OUT_SUFFIX}-branded`,
);
const LOGO_PATH = resolve(process.cwd(), SUNNYSHUTTER_LOGO_RELATIVE);
const SHADE_REF_DIR = resolve(process.cwd(), "assets/sunnyshutter/shade-refs");
const IMAGES_PER_ITEM = 4;

type SourceAsset = { id: string; localPath: string; blobUrl: string };

type ReportItem = {
  index: number;
  idempotencyKey: string;
  templateSlug: string;
  plotVariantId: string;
  productKind: string;
  pullSide: string;
  productImageUrls: string[];
  storyboard?: Image2StoryboardArtifact;
  videoPlanId?: string;
  externalJobId?: string | null;
  status?: string;
  outputVideoUrl?: string | null;
  localPath?: string | null;
  brandedLocalPath?: string | null;
  brandedBlobUrl?: string | null;
  /** 抽帧文字质检结论（fail-open；仅记录不拦截，人工抽检参考） */
  frameQa?: string;
  elapsedMs?: number;
  error?: string | null;
};

type Report = {
  runKey: string;
  purpose: "sunnyshutter-shade-cta-batch10";
  pipelineId: typeof SUNNYSHUTTER_SHADE_PIPELINE_ID;
  templateFamily: typeof SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY;
  planMix: "A_roller6_zebra2_sheer2";
  language: "en";
  dryRun: boolean;
  requestedCount: number;
  durationSec: 15;
  startedAt: string;
  finishedAt?: string;
  sourceAssets: SourceAsset[];
  items: ReportItem[];
};

function hashOf(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function writeReport(report: Report): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function imagesForItem(index: number, assets: SourceAsset[]): SourceAsset[] {
  const shuffled = [...assets].sort((a, b) =>
    hashOf(`${RUN_KEY}:${index}:${a.id}`).localeCompare(
      hashOf(`${RUN_KEY}:${index}:${b.id}`),
    ),
  );
  return shuffled.slice(0, IMAGES_PER_ITEM);
}

async function resolveSources(existing: Report | null): Promise<SourceAsset[]> {
  const priorOk =
    existing?.sourceAssets?.length &&
    existing.sourceAssets.every(
      (asset) =>
        /^https:\/\//i.test(asset.blobUrl) &&
        !/example\.invalid/i.test(asset.blobUrl),
    );
  if (priorOk) return existing!.sourceAssets;
  const files = readdirSync(SHADE_REF_DIR)
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .sort();
  if (files.length < 4) {
    throw new Error(`Need ≥4 shade refs in ${SHADE_REF_DIR}`);
  }
  if (!SUBMIT) {
    return files.map((name, index) => ({
      id: `${RUN_KEY}-src-${index + 1}`,
      localPath: resolve(SHADE_REF_DIR, name),
      blobUrl: `https://example.invalid/dry/${encodeURIComponent(name)}`,
    }));
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN required");
  }
  const assets: SourceAsset[] = [];
  for (const [index, name] of files.entries()) {
    const localPath = resolve(SHADE_REF_DIR, name);
    const blob = await put(
      `real-video-acceptance/${RUN_KEY}/shade-${index + 1}-${name}`,
      readFileSync(localPath),
      {
        access: "public",
        contentType: name.endsWith(".png") ? "image/png" : "image/jpeg",
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );
    assets.push({
      id: `${RUN_KEY}-src-${index + 1}`,
      localPath,
      blobUrl: blob.url,
    });
    console.log(`uploaded shade ref ${index + 1}/${files.length}`);
  }
  return assets;
}

function endCardPlan(): BrandPackagingPlan {
  const copy = SUNNYSHUTTER_END_CARD_COPY.en;
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
      language: "en",
      aspectRatio: "9:16",
    },
  );
}

async function brandOne(args: {
  index: number;
  sourcePath: string;
  endCardUrl: string;
}): Promise<{ localPath: string; blobUrl: string }> {
  if (!existsSync(LOGO_PATH)) throw new Error(`logo missing: ${LOGO_PATH}`);
  mkdirSync(BRANDED_DIR, { recursive: true });
  // Seedance 常在最后 1s 幻觉假名片 — 拼真尾卡前先裁掉尾部。
  const trimmedPath = await trimVideoTail(args.sourcePath, {
    tailSeconds: 0.8,
  });
  const logoCfg = sunnyShutterLogoOverlayConfig();
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
    `ss-shade-${String(args.index).padStart(2, "0")}-branded.mp4`,
  );
  const response = await fetch(brandedUrl);
  if (!response.ok) throw new Error(`download branded ${response.status}`);
  writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
  return { localPath, blobUrl: brandedUrl };
}

async function processItem(item: ReportItem, report: Report): Promise<void> {
  if (item.status === "SUCCEEDED" && item.localPath && existsSync(item.localPath)) {
    console.log(`#${item.index} skip (already SUCCEEDED)`);
    return;
  }
  const t0 = Date.now();
  try {
    if (!item.storyboard?.frames?.length) {
      console.log(`#${item.index} storyboard Image2 (3 frames)…`);
      item.storyboard = await generateShadeStoryboard({
        index1Based: item.index,
        productImageUrls: item.productImageUrls,
        purpose: `${RUN_KEY}:item-${item.index}`,
        providerRequestKeyPrefix: `${RUN_KEY}:${item.index}`,
      });
      writeReport(report);
    }

    console.log(`#${item.index} Fast VIP I2V…`);
    const done = await runShadeI2V({
      index1Based: item.index,
      productImageUrls: item.productImageUrls,
      storyboard: item.storyboard!,
      providerRequestKey: `${item.idempotencyKey}:video`,
    });
    item.externalJobId = done.taskId;
    item.videoPlanId = done.planId;
    item.outputVideoUrl = done.url;
    item.status = "SUCCEEDED";
    writeReport(report);

    mkdirSync(VIDEO_DIR, { recursive: true });
    const localPath = resolve(
      VIDEO_DIR,
      `ss-shade-${String(item.index).padStart(2, "0")}-${item.plotVariantId}.mp4`,
    );
    if (!existsSync(localPath)) {
      const response = await fetch(done.url);
      if (!response.ok) throw new Error(`download ${response.status}`);
      writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
    }
    item.localPath = localPath;

    // 抽帧文字质检（fail-open）：模型画字/假卡 → 记录进报告供人工抽检。
    const qa = await runFrameTextQa(localPath);
    item.frameQa = qa.summary;
    if (qa.checked && !qa.ok) {
      console.warn(`#${item.index} frame-qa: ${qa.summary}`);
    }

    item.elapsedMs = Date.now() - t0;
    writeReport(report);
    console.log(
      `#${item.index} OK → ${basename(localPath)} · ${done.planId} · ${(item.elapsedMs / 1000).toFixed(0)}s`,
    );
  } catch (error) {
    item.status = "FAILED";
    item.error = error instanceof Error ? error.message : String(error);
    item.elapsedMs = Date.now() - t0;
    writeReport(report);
    throw error;
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(
    [
      `SunnyShutter SHADE batch10 · ${SUNNYSHUTTER_SHADE_PIPELINE_ID}`,
      `mode=${SUBMIT ? "SUBMIT" : "DRY RUN"}`,
      `mix=Plan A (~6 roller + 2 zebra + 2 sheer)`,
      `language=en · Fast VIP · 15s × ${ITEM_COUNT}`,
      `runKey=${RUN_KEY}`,
    ].join("\n"),
  );

  const existing = existsSync(REPORT_PATH)
    ? (JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report)
    : null;
  const sourceAssets = await resolveSources(existing);

  const items: ReportItem[] = [];
  for (let index = 1; index <= ITEM_COUNT; index += 1) {
    const variant = pickSunnyShutterShadeVariant(index);
    const imgs = imagesForItem(index, sourceAssets);
    const prior = existing?.items.find((row) => row.index === index);
    items.push({
      index,
      idempotencyKey: `${RUN_KEY}:${index}`,
      templateSlug: variant.slug,
      plotVariantId: variant.id,
      productKind: variant.productKind,
      pullSide: variant.pullSide,
      productImageUrls: imgs.map((a) => a.blobUrl),
      storyboard: prior?.storyboard,
      videoPlanId: prior?.videoPlanId,
      externalJobId: prior?.externalJobId ?? null,
      status: prior?.status,
      outputVideoUrl: prior?.outputVideoUrl ?? null,
      localPath: prior?.localPath ?? null,
      brandedLocalPath: prior?.brandedLocalPath ?? null,
      brandedBlobUrl: prior?.brandedBlobUrl ?? null,
      error: prior?.error ?? null,
      elapsedMs: prior?.elapsedMs,
    });
    console.log(
      `#${String(index).padStart(2, "0")} ${variant.productKind} · pull=${variant.pullSide} · ${variant.id}`,
    );
  }

  const report: Report = {
    runKey: RUN_KEY,
    purpose: "sunnyshutter-shade-cta-batch10",
    pipelineId: SUNNYSHUTTER_SHADE_PIPELINE_ID,
    templateFamily: SUNNYSHUTTER_SHADE_TEMPLATE_FAMILY,
    planMix: "A_roller6_zebra2_sheer2",
    language: "en",
    dryRun: !SUBMIT,
    requestedCount: ITEM_COUNT,
    durationSec: 15,
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    sourceAssets,
    items,
  };
  writeReport(report);

  if (!SUBMIT) {
    console.log(`\nDRY RUN → ${REPORT_PATH}`);
    return;
  }

  console.log(`Shuyu balance: ${(await getShuyuBalance()).available_points} pts`);

  // Canary #1 first
  await processItem(report.items[0]!, report);

  for (const item of report.items.slice(1)) {
    await sleep(1_500);
    try {
      await processItem(item, report);
    } catch (error) {
      console.error(
        `#${item.index} failed — continue. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Retry failed once
  for (const item of report.items.filter((i) => i.status === "FAILED")) {
    console.log(`retry #${item.index}…`);
    item.status = undefined;
    item.error = null;
    item.externalJobId = null;
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

  // Brand EN only
  if (!existsSync(LOGO_PATH)) {
    console.warn("skip branding — logo missing");
  } else {
    const endCard = await renderBrandEndCard({
      briefId: `${RUN_KEY}-end-en`,
      plan: endCardPlan(),
      aspectRatio: "9:16",
      logoUrl: sunnyShutterLogoFileUrl(),
    });
    if (!endCard?.url) throw new Error("end card render failed");
    for (const item of report.items) {
      if (item.status !== "SUCCEEDED" || !item.localPath) continue;
      if (item.brandedLocalPath && existsSync(item.brandedLocalPath)) continue;
      try {
        const branded = await brandOne({
          index: item.index,
          sourcePath: item.localPath,
          endCardUrl: endCard.url,
        });
        item.brandedLocalPath = branded.localPath;
        item.brandedBlobUrl = branded.blobUrl;
        writeReport(report);
        console.log(`#${item.index} branded → ${basename(branded.localPath)}`);
      } catch (error) {
        item.error = [
          item.error,
          `brand: ${error instanceof Error ? error.message : String(error)}`,
        ]
          .filter(Boolean)
          .join(" | ");
        writeReport(report);
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  report.dryRun = false;
  writeReport(report);
  const ok = report.items.filter((i) => i.status === "SUCCEEDED").length;
  const branded = report.items.filter((i) => i.brandedLocalPath).length;
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        succeeded: ok,
        branded,
        failed: report.items
          .filter((i) => i.status === "FAILED")
          .map((i) => ({ index: i.index, error: i.error })),
      },
      null,
      2,
    ),
  );
  if (ok < ITEM_COUNT) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
