/**
 * 2026-08-03 模板库扩容 · 27 个新模板逐一真机出样片。
 *
 * 线路 = 客户真实线路（buddy / Shuyu image2video studio-video，900pt/条），
 * 与 real-video-acceptance-batch20.ts 同构：持久化批量管线 + canary 先行 +
 * 幂等键续跑 + JSON 报告。产品参考图用 gpt-image-2 现场生成并落 blob
 * （每个模板配品类贴合的产品，样片即门面，不能全库一个产品）。
 *
 * 用法（默认只补产品参考图并打印花费计划，不提交付费视频）：
 *   npx tsx scripts/real-template-samples-expansion.ts
 * 确认提交付费视频：
 *   REAL_SAMPLES_CONFIRM_SPEND=1 npx tsx scripts/real-template-samples-expansion.ts
 * 局部重跑（修配方后重出个别模板）：
 *   REAL_SAMPLES_SLUGS=commerce-food-sizzle REAL_SAMPLES_CONFIRM_SPEND=1 npx tsx ...
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { StyleTemplateStatus } from "@prisma/client";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import {
  cancelPendingBatchJobs,
  createBatchJob,
  getBatchStatus,
  isTerminalBatchStatus,
  processBatchTick,
} from "@/lib/services/batch-service";
import { authorizeBatchQuotaForSession } from "@/lib/services/quota-service";
import { VOLCENGINE_CN_ARK_BASE_URL } from "@/lib/config/seedance-runtime";
import { generateImages } from "@/lib/providers/openai-image";
import { getShuyuBalance, SHUYU_VIDEO_POINTS_PER_GENERATION } from "@/lib/providers/shuyu";

loadEnvConfig(process.cwd(), true);

/// 真机硬开关：本脚本存在的意义就是真实出片，杜绝被本地 mock 静默降级。
process.env.VIDEO_ENGINE_MOCK = "false";
process.env.IMAGE_ENGINE_MOCK = "false";

/// 线路选择：默认走客户主线路 buddy(Shuyu)。Shuyu 长时间不可用时可切
/// REAL_SAMPLES_ROUTE=volcengine_cn_legacy——这是平台 C1 客户故障转移的
/// 同一条真实线路(batch20 验收同款配置)，报告里会逐条记录 providerRoute。
const SAMPLE_ROUTE =
  process.env.REAL_SAMPLES_ROUTE === "volcengine_cn_legacy"
    ? ("volcengine_cn_legacy" as const)
    : ("buddy" as const);
if (SAMPLE_ROUTE === "volcengine_cn_legacy") {
  process.env.VIDEO_PROVIDER = "byteplus";
  process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
  process.env.ARK_BASE_URL = VOLCENGINE_CN_ARK_BASE_URL;
  process.env.ARK_VIDEO_MODEL =
    process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128";
} else {
  process.env.VIDEO_PROVIDER = "shuyu";
}

const RUN_KEY =
  process.env.REAL_SAMPLES_RUN_KEY?.trim() || "template-samples-20260803-v1";
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-template-samples");
const REPORT_PATH = resolve(OUTPUT_DIR, `${RUN_KEY}.json`);
const VIDEO_DIR = resolve(OUTPUT_DIR, `${RUN_KEY}-videos`);
const TICK_SPACING_MS = 1_200;
const POLL_MS = 20_000;
const CONFIRM_SPEND = process.env.REAL_SAMPLES_CONFIRM_SPEND === "1";
/// 批次幂等键修订号：v1 用了裸 URL 假 asset id，被故事板锚定管线
/// （resolveOwnedMediaAssets）正确拒绝；v2 起参考图先注册为 MediaAsset；
/// v3 改分波提交——27 个批次一次性全建会让排队尾部越过 timeoutAt+10min
/// 宽限被 sweep 判死（v2 实测 19 条未提交即被扫）。
const BATCH_KEY_REV = "v3";
/// 每波批次数：与计划并发窗口同量级，建了立刻能被派发。
const WAVE_SIZE = Math.max(
  1,
  Number.parseInt(process.env.REAL_SAMPLES_WAVE_SIZE ?? "6", 10) || 6,
);

/// 产品参考图公共约束：写实商品摄影、零文字零商标（画面文字是样片红线）。
const PHOTO_SUFFIX =
  "Photorealistic commercial product photograph, physically accurate materials," +
  " soft diffused studio lighting with realistic contact shadows, crisp focus." +
  " Absolutely no text, no lettering, no logos, no watermarks, no people.";

type ProductSet = {
  productName: string;
  prompts: string[];
};

/// 10 个无品牌通用产品集，覆盖 27 个模板的品类语境。
const PRODUCT_SETS: Record<string, ProductSet> = {
  bottle: {
    productName: "Matte terracotta thermal bottle",
    prompts: [
      `A matte terracotta-colored stainless steel thermal bottle with a brushed steel lid, standing upright on a seamless warm-gray studio background, three-quarter hero angle. ${PHOTO_SUFFIX}`,
      `The same matte terracotta thermal bottle photographed in macro close-up on its lid seam and brushed steel texture, seamless warm-gray background. ${PHOTO_SUFFIX}`,
      `The same matte terracotta thermal bottle standing on a light oak desk beside a closed notebook, soft morning window light, shallow depth of field. ${PHOTO_SUFFIX}`,
    ],
  },
  earbuds: {
    productName: "Pebble wireless earbuds",
    prompts: [
      `A pair of matte white wireless earbuds resting in an open pebble-shaped charging case, seamless light-gray studio background, three-quarter hero angle. ${PHOTO_SUFFIX}`,
      `The same matte white wireless earbuds arranged in a tidy top-down flat lay: open charging case, both earbuds, a short white USB-C cable, and three pairs of silicone ear tips on a light-gray surface. ${PHOTO_SUFFIX}`,
      `One of the same matte white earbuds in extreme close-up showing its curved glossy touch surface and mesh grille, seamless light-gray background. ${PHOTO_SUFFIX}`,
    ],
  },
  serum: {
    productName: "Amber glass facial serum",
    prompts: [
      `An amber glass facial serum bottle with a black dropper cap, standing on a seamless blush-beige studio background, front hero angle. ${PHOTO_SUFFIX}`,
      `The same amber glass serum bottle beside a small swatch of golden serum texture smeared on a white ceramic tile, top-down macro. ${PHOTO_SUFFIX}`,
      `The same amber glass serum bottle inside an open minimalist cream gift box with soft crinkle paper, seamless blush-beige background. ${PHOTO_SUFFIX}`,
    ],
  },
  tintTrio: {
    productName: "Velvet lip tint trio",
    prompts: [
      `Three identical slim lip tint tubes in three shades (soft rose, warm coral, deep berry) standing in an even row on a seamless ivory studio background, front view, equal spacing. ${PHOTO_SUFFIX}`,
      `One slim lip tint tube in warm coral standing alone as the hero on the same seamless ivory background, three-quarter angle. ${PHOTO_SUFFIX}`,
    ],
  },
  watch: {
    productName: "Minimal steel field watch",
    prompts: [
      `A minimal stainless steel field watch with a matte black dial and dark brown leather strap, laid on dark slate stone, dramatic low-key lighting with a soft rim light tracing the case. ${PHOTO_SUFFIX}`,
      `The same steel field watch in extreme macro on the dial texture, brushed bezel and stitched leather strap grain, dark background, raking light. ${PHOTO_SUFFIX}`,
      `The same steel field watch standing upright with the strap curled around it on a dark walnut table, moody warm side light. ${PHOTO_SUFFIX}`,
    ],
  },
  sneaker: {
    productName: "Retro suede runner sneakers",
    prompts: [
      `A pair of retro running sneakers in sage-green suede with gum rubber soles and cream laces, one shoe angled on a seamless off-white studio background. ${PHOTO_SUFFIX}`,
      `The same sage-green suede runner in macro close-up on the suede grain, stitching, and gum sole edge, off-white background. ${PHOTO_SUFFIX}`,
      `The same pair of sage-green suede runners on a sunlit concrete sidewalk, casual street context, shallow depth of field. ${PHOTO_SUFFIX}`,
    ],
  },
  backpack: {
    productName: "Roll-top canvas trail backpack",
    prompts: [
      `An olive waxed-canvas roll-top backpack with black buckles and leather trim, standing upright on a seamless stone-gray studio background, three-quarter angle. ${PHOTO_SUFFIX}`,
      `The same olive roll-top backpack with its main compartment opened flat showing padded interior pockets and one folded gray shirt inside, top-down. ${PHOTO_SUFFIX}`,
      `The same olive roll-top backpack leaning against a mossy boulder on a forest trail, overcast natural light. ${PHOTO_SUFFIX}`,
    ],
  },
  pillow: {
    productName: "Cream boucle throw pillow",
    prompts: [
      `A plain mid-gray fabric sofa in a bright minimal living room with empty seat cushions, straight-on medium-wide framing, soft daylight. ${PHOTO_SUFFIX}`,
      `The exact same mid-gray sofa from the exact same straight-on angle and daylight, now styled with two cream boucle throw pillows placed upright on the seat. ${PHOTO_SUFFIX}`,
      `One cream boucle throw pillow in macro close-up showing the looped boucle texture and piped seam, neutral background. ${PHOTO_SUFFIX}`,
      `The same cream boucle throw pillow propped on a light oak reading chair beside a window, cozy corner context. ${PHOTO_SUFFIX}`,
    ],
  },
  coffee: {
    productName: "Single-origin roast coffee",
    prompts: [
      `A matte kraft-brown coffee bag with a plain unprinted surface and a simple tin tie, standing beside a small pile of roasted coffee beans on a warm walnut counter. ${PHOTO_SUFFIX}`,
      `A white ceramic cup of freshly brewed black coffee with natural crema swirl beside the same plain kraft coffee bag, top-down on walnut, morning light. ${PHOTO_SUFFIX}`,
      `Roasted coffee beans in extreme macro showing oil sheen and bean texture, warm light. ${PHOTO_SUFFIX}`,
    ],
  },
  petToy: {
    productName: "Braided rope dog toy",
    prompts: [
      `A braided cotton rope dog toy in teal and natural white with a knotted loop, on a seamless warm-cream studio background. ${PHOTO_SUFFIX}`,
      `The same teal braided rope dog toy lying on a living room rug beside a dog bed, cozy home context, soft daylight. ${PHOTO_SUFFIX}`,
      `The same teal braided rope toy in macro close-up on the braid texture and knot, warm-cream background. ${PHOTO_SUFFIX}`,
    ],
  },
};

/// 模板 → 产品集 映射（27 条，与 catalog 扩容批次一一对应）。
const TEMPLATE_PLAN: Array<{ slug: string; set: keyof typeof PRODUCT_SETS }> = [
  { slug: "commerce-talking-head-review", set: "bottle" },
  { slug: "commerce-podcast-authority", set: "watch" },
  { slug: "commerce-founder-story", set: "backpack" },
  { slug: "commerce-street-interview", set: "sneaker" },
  { slug: "commerce-hook-face-demo", set: "sneaker" },
  { slug: "commerce-triple-proof", set: "bottle" },
  { slug: "commerce-creator-reaction", set: "earbuds" },
  { slug: "commerce-before-after-match", set: "pillow" },
  { slug: "commerce-360-hero-orbit", set: "bottle" },
  { slug: "commerce-variant-lineup", set: "tintTrio" },
  { slug: "commerce-whats-in-box", set: "earbuds" },
  { slug: "commerce-in-hand-scale", set: "bottle" },
  { slug: "commerce-macro-texture-asmr", set: "watch" },
  { slug: "commerce-dark-luxury-light", set: "watch" },
  { slug: "commerce-morning-routine", set: "coffee" },
  { slug: "commerce-pov-immersive", set: "earbuds" },
  { slug: "commerce-dual-context", set: "pillow" },
  { slug: "commerce-pet-companion", set: "petToy" },
  { slug: "commerce-home-space-styling", set: "pillow" },
  { slug: "commerce-fashion-lookbook", set: "sneaker" },
  { slug: "commerce-beauty-texture", set: "serum" },
  { slug: "commerce-food-sizzle", set: "coffee" },
  { slug: "commerce-tech-feature-focus", set: "earbuds" },
  { slug: "commerce-outdoor-rugged", set: "backpack" },
  { slug: "commerce-travel-pack-flow", set: "backpack" },
  { slug: "commerce-gift-unwrap", set: "serum" },
];

const SLUG_FILTER: Set<string> | null = (() => {
  const raw = (process.env.REAL_SAMPLES_SLUGS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  return raw.length > 0 ? new Set(raw) : null;
})();
/// QA 淘汰重跑：即使该 slug 之前 SUCCEEDED 也重新生成（配方升版后必须配合
/// REAL_SAMPLES_SLUGS 白名单使用，防止误重跑全量）。
const FORCE_RERUN = process.env.REAL_SAMPLES_FORCE === "1" && SLUG_FILTER !== null;

type ReportItem = {
  slug: string;
  set: string;
  idempotencyKey: string;
  templateId?: string;
  templateVersion?: number;
  templateNameZh?: string;
  batchId?: string;
  videoJobId?: string;
  externalJobId?: string | null;
  status?: string;
  providerStatus?: string | null;
  outputVideoUrl?: string | null;
  localPath?: string | null;
  error?: string | null;
};

type Report = {
  runKey: string;
  purpose: "template-library-expansion-samples";
  providerRoute: "buddy";
  startedAt: string;
  finishedAt?: string;
  productImages: Record<string, string[]>;
  /// 参考图注册成 MediaAsset 后的 {id, url}，与 productImages 同序。
  productAssets?: Record<string, Array<{ id: string; url: string }>>;
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

async function ensureProductImages(report: Report): Promise<void> {
  for (const [setId, set] of Object.entries(PRODUCT_SETS)) {
    const existing = report.productImages[setId] ?? [];
    if (existing.length >= set.prompts.length) continue;
    for (let index = existing.length; index < set.prompts.length; index += 1) {
      const result = await generateImages({
        prompt: set.prompts[index],
        n: 1,
        size: "1024x1536",
        quality: "medium",
        blobPrefix: `template-samples/${RUN_KEY}/${setId}/`,
      });
      if (result.fromMock) {
        throw new Error("图像引擎落到 mock，检查 OPENAI_API_KEY / IMAGE_ENGINE_MOCK");
      }
      existing.push(result.urls[0]);
      report.productImages[setId] = existing;
      writeReport(report);
      console.log(`ref image ready: ${setId} ${index + 1}/${set.prompts.length}`);
    }
  }
}

/// 生成的参考图必须是验收用户名下的真实 MediaAsset，故事板锚定管线才认。
async function ensureMediaAssets(report: Report, userId: string): Promise<void> {
  report.productAssets ??= {};
  for (const [setId, urls] of Object.entries(report.productImages)) {
    const existing = report.productAssets[setId] ?? [];
    if (existing.length >= urls.length) continue;
    for (let index = existing.length; index < urls.length; index += 1) {
      const url = urls[index];
      const storageKey = new URL(url).pathname.replace(/^\/+/, "");
      const prior = await db.mediaAsset.findUnique({ where: { storageKey } });
      if (prior) {
        existing.push({ id: prior.id, url: prior.url });
      } else {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`ref download failed: ${url}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const created = await db.mediaAsset.create({
          data: {
            userId,
            storageKey,
            url,
            mimeType: "image/png",
            byteSize: buffer.byteLength,
            sha256: createHash("sha256").update(buffer).digest("hex"),
            width: 1024,
            height: 1536,
          },
        });
        existing.push({ id: created.id, url: created.url });
      }
      report.productAssets[setId] = existing;
      writeReport(report);
    }
    console.log(`media assets ready: ${setId} ${existing.length}/${urls.length}`);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const report: Report = readReport() ?? {
    runKey: RUN_KEY,
    purpose: "template-library-expansion-samples",
    providerRoute: "buddy",
    startedAt: new Date().toISOString(),
    productImages: {},
    items: [],
  };
  writeReport(report);

  await ensureProductImages(report);

  const plan = TEMPLATE_PLAN.filter(
    (entry) => !SLUG_FILTER || SLUG_FILTER.has(entry.slug),
  );
  const done = new Set(
    report.items
      .filter(
        (item) =>
          item.status === "SUCCEEDED" &&
          !(FORCE_RERUN && SLUG_FILTER?.has(item.slug)),
      )
      .map((item) => item.slug),
  );
  const pending = plan.filter((entry) => !done.has(entry.slug));
  const plannedPoints = pending.length * SHUYU_VIDEO_POINTS_PER_GENERATION;

  if (!CONFIRM_SPEND) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-plan",
          refsReady: Object.fromEntries(
            Object.entries(report.productImages).map(([k, v]) => [k, v.length]),
          ),
          pendingVideos: pending.map((entry) => entry.slug),
          plannedPoints,
          hint: "REAL_SAMPLES_CONFIRM_SPEND=1 重新运行以提交真机视频",
        },
        null,
        2,
      ),
    );
    return;
  }

  const balance = await getShuyuBalance();
  if (balance.available_points < plannedPoints + 2 * SHUYU_VIDEO_POINTS_PER_GENERATION) {
    throw new Error(
      `Shuyu 余额不足：available=${balance.available_points}，本轮需 ${plannedPoints}（含重试余量）`,
    );
  }
  console.log(
    `Shuyu balance ok: ${balance.available_points} points, planned ${plannedPoints}`,
  );

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const user = await db.adminUser.findFirst({
    where: adminEmail ? { email: adminEmail } : { role: "SUPER_ADMIN" },
  });
  if (!user) throw new Error("No acceptance user found");

  const templates = await db.styleTemplate.findMany({
    where: {
      slug: { in: plan.map((entry) => entry.slug) },
      status: StyleTemplateStatus.ACTIVE,
    },
  });
  const templateBySlug = new Map(templates.map((t) => [t.slug, t]));
  const missing = plan.filter((entry) => !templateBySlug.has(entry.slug));
  if (missing.length > 0) {
    throw new Error(
      `以下模板未 ACTIVE（先跑 seed-style-templates-target）：${missing.map((m) => m.slug).join(", ")}`,
    );
  }

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

  await ensureMediaAssets(report, user.id);

  /// 旧修订号的批次按可取消纪律清场：清幂等键占用、保留素材。
  /// 已 SUCCEEDED 的条目无论修订号一律保留——它们是已付费的有效样片。
  for (const item of report.items) {
    if (!item.batchId || item.status === "SUCCEEDED") continue;
    if (item.idempotencyKey.includes(`:${BATCH_KEY_REV}`)) continue;
    const cancelled = await cancelPendingBatchJobs(item.batchId);
    console.log(`cancelled stale batch ${item.batchId} (${item.slug}): ${cancelled} jobs`);
  }
  report.items = report.items.filter(
    (item) =>
      item.status === "SUCCEEDED" ||
      item.idempotencyKey.includes(`:${BATCH_KEY_REV}`),
  );
  writeReport(report);

  /// 分波提交：一波建满立刻打到终态，再开下一波。
  /// timeoutAt 在批次创建时就定死，一次性全建会让队尾在拿到并发窗口前先过期。
  const pendingEntries = plan.filter((entry) => !done.has(entry.slug));
  const waves: Array<typeof pendingEntries> = [];
  for (let i = 0; i < pendingEntries.length; i += WAVE_SIZE) {
    waves.push(pendingEntries.slice(i, i + WAVE_SIZE));
  }

  for (const [waveIndex, wave] of waves.entries()) {
    console.log(
      `wave ${waveIndex + 1}/${waves.length}: ${wave.map((w) => w.slug).join(", ")}`,
    );
    const waveItems: ReportItem[] = [];
    for (const entry of wave) {
      const template = templateBySlug.get(entry.slug)!;
      const assets = report.productAssets?.[entry.set] ?? [];
      if (assets.length === 0) throw new Error(`产品集 ${entry.set} 没有已注册的参考资产`);
      /// 幂等键并入线路与（force 时的）模板版本：requestHash 含路由快照与
      /// templateVersion，同键换任一个都会被判重放冲突。
      const routeSuffix = SAMPLE_ROUTE === "volcengine_cn_legacy" ? ":vol" : "";
      const idempotencyKey = FORCE_RERUN
        ? `${RUN_KEY}:${entry.slug}:${BATCH_KEY_REV}${routeSuffix}:t${template.version}${
            process.env.REAL_SAMPLES_RETRY_REV
              ? `:r${process.env.REAL_SAMPLES_RETRY_REV}`
              : ""
          }`
        : `${RUN_KEY}:${entry.slug}:${BATCH_KEY_REV}${routeSuffix}`;
      const batch = await createBatchJob({
        userId: user.id,
        templateId: template.id,
        templateVersion: template.version,
        images: assets.slice(0, 4).map((asset) => ({ id: asset.id, url: asset.url })),
        requestedCount: 1,
        productName: PRODUCT_SETS[entry.set].productName,
        idempotencyKey,
        videoRouteId: SAMPLE_ROUTE,
        isInternalStaff: true,
      });
      await authorizeBatchQuotaForSession(session, batch.id);
      const priorIndex = report.items.findIndex((item) => item.slug === entry.slug);
      const item: ReportItem = {
        ...(priorIndex >= 0 ? report.items[priorIndex] : {}),
        slug: entry.slug,
        set: entry.set,
        idempotencyKey,
        templateId: template.id,
        templateVersion: template.version,
        templateNameZh: template.nameZh,
        batchId: batch.id,
        status: undefined,
        externalJobId: null,
        outputVideoUrl: null,
        error: null,
      };
      if (priorIndex >= 0) report.items[priorIndex] = item;
      else report.items.push(item);
      waveItems.push(item);
      writeReport(report);
    }

    const waveDeadline = Date.now() + 30 * 60_000;
    for (;;) {
      let terminalCount = 0;
      for (const item of waveItems) {
        const current = await getBatchStatus(item.batchId!, user.id);
        if (!isTerminalBatchStatus(current.status)) {
          await processBatchTick(item.batchId!);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, TICK_SPACING_MS));
        }
        const after = await getBatchStatus(item.batchId!, user.id);
        const job = after.videoJobs[0];
        item.videoJobId = job?.id;
        item.externalJobId = job?.externalJobId;
        item.status = job?.status ?? after.status;
        item.providerStatus = job?.lastProviderStatus;
        item.outputVideoUrl = job?.outputVideoUrl;
        item.error = job?.errorMessage ?? job?.userSafeError ?? null;
        if (isTerminalBatchStatus(after.status)) terminalCount += 1;
      }
      writeReport(report);
      const counts = Object.groupBy(waveItems, (item) => item.status ?? "UNKNOWN");
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          wave: `${waveIndex + 1}/${waves.length}`,
          terminalCount,
          total: waveItems.length,
          statuses: Object.fromEntries(
            Object.entries(counts).map(([key, values]) => [key, values?.length ?? 0]),
          ),
        }),
      );
      if (terminalCount === waveItems.length) break;
      if (Date.now() > waveDeadline) {
        console.log(`wave ${waveIndex + 1} 超时，进入下一波（未完条目可重跑续）`);
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, POLL_MS));
    }

    /// 全波即时覆没（供应商维护/封禁/配额）就停止后续波次，避免连环烧钱。
    const waveFailedCount = waveItems.filter((item) => item.status === "FAILED").length;
    if (waveItems.length > 1 && waveFailedCount === waveItems.length) {
      throw new Error(`wave ${waveIndex + 1} 全部失败，停止后续波次；检查供应商状态后重跑`);
    }
  }

  mkdirSync(VIDEO_DIR, { recursive: true });
  for (const item of report.items) {
    if (!item.outputVideoUrl) continue;
    const path = resolve(VIDEO_DIR, `${item.slug}.mp4`);
    /// 强制重跑的 slug 永远以最新成片为准，旧文件直接覆盖。
    if (FORCE_RERUN && SLUG_FILTER?.has(item.slug) && existsSync(path)) {
      const response = await fetch(item.outputVideoUrl);
      if (!response.ok) throw new Error(`download ${item.slug} failed (${response.status})`);
      writeFileSync(path, Buffer.from(await response.arrayBuffer()));
      item.localPath = path;
      writeReport(report);
      continue;
    }
    if (!existsSync(path)) {
      const response = await fetch(item.outputVideoUrl);
      if (!response.ok) throw new Error(`download ${item.slug} failed (${response.status})`);
      writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    }
    item.localPath = path;
    writeReport(report);
  }

  report.finishedAt = new Date().toISOString();
  writeReport(report);
  const ranItems = report.items.filter((item) =>
    plan.some((entry) => entry.slug === item.slug),
  );
  const failed = ranItems.filter((item) => item.status !== "SUCCEEDED");
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        succeeded: ranItems.length - failed.length,
        failed: failed.map((item) => ({ slug: item.slug, error: item.error })),
      },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 2;
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
