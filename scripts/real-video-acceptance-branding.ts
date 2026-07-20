/**
 * Real-provider acceptance · 品牌包装后处理（CEO 广告要求）。
 *
 * 对已生成的验收视频统一注入：
 *   1. SUNNY logo 角标（brand-overlay-renderer，全程右下角）
 *   2. 3 秒品牌尾卡（brand-end-card-renderer：logo + CTA + 电话 + 地址）
 *   3. runFfmpegNormalizeAndConcat 正片+尾卡拼接 → Blob
 *
 * 输入：batch18-volc-v2.json + 30s-v1.json 里 localPath 就绪的条目。
 * 输出：tmp/real-video-acceptance/branded-v1/ + branding-v1.json 报告。
 * 幂等：按输出文件存在性跳过。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true);

import { applyBrandOverlay } from "@/lib/video-generation/brand-overlay-renderer";
import { renderBrandEndCard } from "@/lib/video-generation/brand-end-card-renderer";
import { runFfmpegNormalizeAndConcat } from "@/lib/services/stitch-service";
import {
  SUNNYSHUTTER_END_CARD_COPY,
  SUNNYSHUTTER_LOGO_RELATIVE,
  applySunnyShutterBrandPack,
  sunnyShutterLogoFileUrl,
} from "@/lib/video-generation/sunnyshutter-brand-pack";
import type { BrandPackagingPlan } from "@/types/video-generation";

const RUN_KEY = "real-acceptance-20260719-branding-v1";
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-video-acceptance");
const BRANDED_DIR = resolve(OUTPUT_DIR, "branded-v1");
const REPORT_PATH = resolve(OUTPUT_DIR, "branding-v1.json");
const BATCH_REPORTS = [
  resolve(OUTPUT_DIR, "batch18-volc-v2.json"),
  resolve(OUTPUT_DIR, "volc-batch18-v3.json"),
];
const REPORT_30S = resolve(OUTPUT_DIR, "30s-v1.json");
const LOGO_PATH = resolve(process.cwd(), SUNNYSHUTTER_LOGO_RELATIVE);

function endCardPlan(
  language: "en" | "zh",
  aspectRatio: string,
): BrandPackagingPlan {
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
      aspectRatio,
    },
  );
}

type WorkItem = {
  name: string;
  sourcePath: string;
  language: "en" | "zh";
  aspectRatio: "9:16" | "16:9";
};

type BrandedRecord = WorkItem & {
  overlaidPath?: string;
  endCardUrl?: string;
  brandedBlobUrl?: string;
  brandedLocalPath?: string;
  error?: string;
};

function collectWorkItems(): WorkItem[] {
  const items: WorkItem[] = [];
  for (const batchReport of BATCH_REPORTS.filter((path) => existsSync(path))) {
    const batch = JSON.parse(readFileSync(batchReport, "utf8")) as {
      items: Array<{
        index: number;
        templateSlug: string;
        localPath?: string | null;
        status?: string;
      }>;
    };
    for (const item of batch.items) {
      if (item.status !== "SUCCEEDED" || !item.localPath) continue;
      if (!existsSync(item.localPath)) continue;
      items.push({
        name: `batch-${String(item.index).padStart(2, "0")}-${item.templateSlug}`,
        sourcePath: item.localPath,
        /// 5/10/15 号用中文尾卡（对华人商家侧投放），其余英文
        language: item.index % 5 === 0 ? "zh" : "en",
        aspectRatio: "9:16",
      });
    }
  }
  if (existsSync(REPORT_30S)) {
    const r30 = JSON.parse(readFileSync(REPORT_30S, "utf8")) as {
      videos: Array<{
        id: string;
        language: string;
        captionedLocalPath?: string | null;
      }>;
    };
    for (const video of r30.videos) {
      if (!video.captionedLocalPath || !existsSync(video.captionedLocalPath)) continue;
      items.push({
        name: `30s-${video.id}`,
        sourcePath: video.captionedLocalPath,
        language: video.language === "zh" ? "zh" : "en",
        aspectRatio: "9:16",
      });
    }
  }
  return items;
}

async function main(): Promise<void> {
  if (!existsSync(LOGO_PATH)) throw new Error(`logo missing: ${LOGO_PATH}`);
  mkdirSync(BRANDED_DIR, { recursive: true });
  const records: BrandedRecord[] = existsSync(REPORT_PATH)
    ? (JSON.parse(readFileSync(REPORT_PATH, "utf8")) as BrandedRecord[])
    : [];
  const byName = new Map(records.map((record) => [record.name, record]));

  const work = collectWorkItems();
  if (work.length === 0) {
    throw new Error("No completed acceptance videos found to brand yet");
  }
  console.log(`branding ${work.length} videos`);

  /// end card 按 (language, aspect) 渲染一次复用
  const endCards = new Map<string, string>();
  async function endCardFor(language: "en" | "zh", aspect: string): Promise<string> {
    const key = `${language}:${aspect}`;
    const cached = endCards.get(key);
    if (cached) return cached;
    const rendered = await renderBrandEndCard({
      briefId: `${RUN_KEY}-${key}`,
      plan: endCardPlan(language, aspect),
      aspectRatio: aspect,
      logoUrl: sunnyShutterLogoFileUrl(),
    });
    if (!rendered?.url) {
      throw new Error(
        `end card render failed (${key}): ${rendered?.warnings.join("; ") ?? "null result"}`,
      );
    }
    endCards.set(key, rendered.url);
    return rendered.url;
  }

  for (const item of work) {
    const record: BrandedRecord = byName.get(item.name) ?? { ...item };
    byName.set(item.name, record);
    const finalLocal = resolve(BRANDED_DIR, `${item.name}-branded.mp4`);
    if (record.brandedBlobUrl && existsSync(finalLocal)) continue;
    try {
      // 1) logo 角标
      const overlay = await applyBrandOverlay({
        sourceVideo: item.sourcePath,
        logo: LOGO_PATH,
        placement: "bottom-right",
        durationMode: "full_video",
        logoWidthRatio: 0.16,
        opacity: 0.9,
        outputDir: BRANDED_DIR,
      });
      record.overlaidPath = overlay.outputPath;

      // 2) 品牌尾卡
      const endCardUrl = await endCardFor(item.language, item.aspectRatio);
      record.endCardUrl = endCardUrl;

      // 3) 正片 + 尾卡拼接（归一化 + Blob 上传）
      const brandedUrl = await runFfmpegNormalizeAndConcat({
        finalVideoId: `${RUN_KEY}-${item.name}`,
        aspectRatio: item.aspectRatio,
        clips: [
          { url: overlay.outputUrl, intendedDurationSec: null, trimToFit: false },
          { url: endCardUrl, intendedDurationSec: 3, trimToFit: true },
        ],
      });
      record.brandedBlobUrl = brandedUrl;

      const response = await fetch(brandedUrl);
      if (!response.ok) throw new Error(`download branded failed (${response.status})`);
      writeFileSync(finalLocal, Buffer.from(await response.arrayBuffer()));
      record.brandedLocalPath = finalLocal;
      record.error = undefined;
      console.log(`✓ ${item.name} -> ${basename(finalLocal)}`);
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      console.error(`✗ ${item.name}: ${record.error}`);
    }
    writeFileSync(
      REPORT_PATH,
      `${JSON.stringify([...byName.values()], null, 2)}\n`,
      "utf8",
    );
  }

  const failed = [...byName.values()].filter((record) => record.error);
  console.log(
    JSON.stringify(
      { reportPath: REPORT_PATH, total: byName.size, failed: failed.length },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
