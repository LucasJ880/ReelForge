/**
 * 2026-08-03 模板库扩容 · 模板逐一真机出样片；2026-10-26 起多线路化（X-SCAF-1）。
 *
 * 线路 = 客户真实线路（buddy / Shuyu image2video studio-video，单价按 /prices 实时审计），
 * 与 real-video-acceptance-batch20.ts 同构：持久化批量管线 + 幂等键续跑 + JSON 报告。
 * 产品参考图用 gpt-image-2 现场生成并落 blob（每个模板配品类贴合的产品，样片即门面）。
 *
 * 默认是安全的：不带 REAL_SAMPLES_CONFIRM_SPEND=1 时不生成参考图、不连库、不触网，
 * 只按本地报告打印待跑清单（加 --live-price 才读一次 Shuyu /prices 给出实时估价）。
 *
 * 用法：
 *   npx tsx scripts/real-template-samples-expansion.ts --help
 *   npx tsx scripts/real-template-samples-expansion.ts                     # 干跑：待跑清单
 *   npx tsx scripts/real-template-samples-expansion.ts --live-price        # 干跑 + 实时估价（只读 /prices）
 *   REAL_SAMPLES_CONFIRM_SPEND=1 REAL_SAMPLES_MAX_POINTS=20000 npx tsx scripts/real-template-samples-expansion.ts
 * 多线路对照（运行键必须 exp-2611- 开头，并发自动压到 ≤2；1080P 档还要 SHUYU_ALLOW_FINAL_TIER=1）：
 *   REAL_SAMPLES_RUN_KEY=exp-2611-e12-a REAL_SAMPLES_ROUTE=buddy,buddy@<1080P planId> \
 *   SHUYU_ALLOW_FINAL_TIER=1 REAL_SAMPLES_SLUGS=commerce-food-sizzle \
 *   REAL_SAMPLES_CONFIRM_SPEND=1 REAL_SAMPLES_MAX_POINTS=8000 npx tsx scripts/real-template-samples-expansion.ts
 * 局部重跑（修配方后重出个别模板）：
 *   REAL_SAMPLES_SLUGS=commerce-food-sizzle REAL_SAMPLES_FORCE=1 REAL_SAMPLES_CONFIRM_SPEND=1 ...
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
import {
  getShuyuBalance,
  resolveShuyuVideoPlan,
  shuyuVideoPlanPointsForDuration,
} from "@/lib/providers/shuyu";
import {
  SHUYU_RESERVE_POINTS_DEFAULT,
  checkBudgetGate,
  estimateSpend,
  parsePositiveLimit,
  type SpendLine,
} from "./lib/experiment-budget";
import {
  BATCH_KEY_REV,
  advanceTiming,
  assertRunKeyForArms,
  effectiveWaveSize,
  emptyQa,
  inferLegacyArmId,
  isCurrentRevKey,
  isExperimentRun,
  itemIdentity,
  parseSampleArms,
  sampleIdempotencyKey,
  sampleVideoFileName,
  type SampleArm,
  type SampleQa,
} from "./lib/real-samples-plan";

const HELP = `real-template-samples-expansion —— 模板样片真机出片（多线路，默认干跑）

env：
  REAL_SAMPLES_ROUTE           逗号分隔的线路臂：buddy | buddy@<planId> | volcengine_cn_legacy（默认 buddy）
  REAL_SAMPLES_RUN_KEY         运行键（默认 template-samples-20260803-v1；多臂/显式套餐必须 exp-2611- 开头）
  REAL_SAMPLES_SLUGS           只跑这些模板（逗号分隔）
  REAL_SAMPLES_FORCE=1         配合 SLUGS：已成功的也重出
  REAL_SAMPLES_WAVE_SIZE       每波批次数（默认 6；对照实验强制 ≤2）
  REAL_SAMPLES_CONFIRM_SPEND=1 真的花钱（生成参考图 + 提交视频）；不设 = 干跑
  REAL_SAMPLES_MAX_POINTS      Shuyu 积分硬上限（花钱时必填）
  REAL_SAMPLES_RESERVE_POINTS  余额预留线（默认 ${SHUYU_RESERVE_POINTS_DEFAULT}）
  REAL_SAMPLES_MAX_USD         美元硬上限（volcengine 臂花钱时必填）
  REAL_SAMPLES_VOLC_USD_PER_SECOND  volcengine 臂的美元单价/秒（没有就拒绝花钱）
  REAL_SAMPLES_USD_PER_POINT   可选：把 Shuyu 积分折成 costUsd 写进报告
  SHUYU_ALLOW_FINAL_TIER=1     允许 buddy@<1080P planId>（生产 Vercel 环境一律忽略）

flag：
  --help         打印本说明
  --live-price   干跑时读一次 Shuyu /prices（只读、免费）给出实时估价；默认干跑完全不触网`;

const CLI_ARGS = new Set(process.argv.slice(2));
const LIVE_PRICE = CLI_ARGS.has("--live-price");

const ARMS: SampleArm[] = parseSampleArms(process.env.REAL_SAMPLES_ROUTE);
const RUN_KEY =
  process.env.REAL_SAMPLES_RUN_KEY?.trim() || "template-samples-20260803-v1";
const OUTPUT_DIR = resolve(process.cwd(), "tmp/real-template-samples");
const REPORT_PATH = resolve(OUTPUT_DIR, `${RUN_KEY}.json`);
const VIDEO_DIR = resolve(OUTPUT_DIR, `${RUN_KEY}-videos`);
const TICK_SPACING_MS = 1_200;
const POLL_MS = 20_000;
const CONFIRM_SPEND = process.env.REAL_SAMPLES_CONFIRM_SPEND === "1";
const DEFAULT_DURATION_SEC = 15;
/// 每波批次数：与计划并发窗口同量级，建了立刻能被派发；对照实验按 X-SCAF-0 压到 ≤2。
const WAVE_SIZE = effectiveWaveSize(
  Number.parseInt(process.env.REAL_SAMPLES_WAVE_SIZE ?? "6", 10) || 6,
  ARMS,
);

/// 真机硬开关 + 线路 env：只在真的要跑时设置（--help 不碰进程环境）。
function applyRuntimeEnv(): void {
  loadEnvConfig(process.cwd(), true);
  /// 本脚本存在的意义就是真实出片，杜绝被本地 mock 静默降级。
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.IMAGE_ENGINE_MOCK = "false";
  /// volcengine_cn_legacy 是平台 C1 客户故障转移的同一条真实线路（batch20 验收同款配置），
  /// 靠进程级 env 切 provider，所以 parseSampleArms 保证它只能单独跑。
  if (ARMS.some((arm) => arm.routeId === "volcengine_cn_legacy")) {
    process.env.VIDEO_PROVIDER = "byteplus";
    process.env.SEEDANCE_RUNTIME_PROFILE = "volcengine_cn_legacy";
    process.env.ARK_BASE_URL = VOLCENGINE_CN_ARK_BASE_URL;
    process.env.ARK_VIDEO_MODEL =
      process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128";
  } else {
    process.env.VIDEO_PROVIDER = "shuyu";
  }
}

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
  { slug: "commerce-triple-proof", set: "watch" },
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
  /// 框架 v2（1024）新增 8 个电商带货模板，1025 整合轮补样片。
  { slug: "commerce-aesthetic-mood", set: "serum" },
  { slug: "commerce-ugc-testimonial", set: "bottle" },
  { slug: "commerce-demo-first-reveal", set: "earbuds" },
  { slug: "commerce-single-feature-proof", set: "backpack" },
  { slug: "commerce-unboxing-transform", set: "earbuds" },
  { slug: "commerce-value-proof", set: "watch" },
  { slug: "commerce-problem-solution", set: "pillow" },
  { slug: "commerce-hard-sell-presenter", set: "coffee" },
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
  /** 线路臂（v4 起必有；v3 及更早的条目由 inferLegacyArmId 补齐）。 */
  armId?: string;
  routeId?: SampleArm["routeId"];
  planId?: string | null;
  idempotencyKey: string;
  templateId?: string;
  templateVersion?: number;
  templateNameZh?: string;
  durationSec?: number;
  batchId?: string;
  videoJobId?: string;
  externalJobId?: string | null;
  status?: string;
  providerStatus?: string | null;
  outputVideoUrl?: string | null;
  localPath?: string | null;
  error?: string | null;
  /** 库里 VideoJob.submittedAt（提交给供应商的时刻）。 */
  submittedAt?: string | null;
  /** 轮询第一次观察到供应商处理中的时刻（精度 = 轮询间隔；库里没有对应列）。 */
  firstProcessingAt?: string | null;
  /** 库里 VideoJob.finishedAt。 */
  finishedAt?: string | null;
  /** 单条积分：优先库里 providerUnitPoints 快照，没有就用提交前的实时估价。 */
  costPoints?: number | null;
  costPointsSource?: "snapshot" | "estimate" | null;
  /** 单条美元：库里 providerUnitPriceUsd，或按 REAL_SAMPLES_USD_PER_POINT / VOLC 单价折算；未知 = null。 */
  costUsd?: number | null;
  /** 人工 QA 0–2（商品 / 人物 / 口型），脚本只建空位，由评审回填；重跑新片时清空。 */
  qa?: SampleQa;
};

type Report = {
  runKey: string;
  purpose: "template-library-expansion-samples";
  /** v4 之前只有 "buddy"；v4 起是本轮全部臂。 */
  providerRoute: string;
  arms?: SampleArm[];
  batchKeyRev?: string;
  startedAt: string;
  finishedAt?: string;
  productImages: Record<string, string[]>;
  /// 参考图注册成 MediaAsset 后的 {id, url}，与 productImages 同序。
  productAssets?: Record<string, Array<{ id: string; url: string }>>;
  /** 最近一次花钱前的预估与闸门结论。 */
  budget?: {
    at: string;
    estimate: ReturnType<typeof estimateSpend>;
    availablePoints: number | null;
    maxPoints: number | null;
    maxUsd: number | null;
    reservePoints: number;
  };
  items: ReportItem[];
};

function readReport(): Report | null {
  if (!existsSync(REPORT_PATH)) return null;
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;
  for (const item of report.items) {
    item.armId ??= inferLegacyArmId(item);
    item.qa ??= emptyQa();
  }
  return report;
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

function missingProductImageCount(report: Report): number {
  return Object.entries(PRODUCT_SETS).reduce(
    (sum, [setId, set]) =>
      sum + Math.max(0, set.prompts.length - (report.productImages[setId]?.length ?? 0)),
    0,
  );
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

type PlanEntry = (typeof TEMPLATE_PLAN)[number];
type PendingRun = { entry: PlanEntry; arm: SampleArm };

/** 每个臂的单条实时价（Shuyu /prices 审计）；volcengine 臂按 env 的美元单价。 */
async function priceArms(
  arms: ReadonlyArray<SampleArm>,
  durationSec: number,
): Promise<Map<string, { unitPoints: number | null; unitUsd: number | null; note: string }>> {
  const usdPerPoint = parsePositiveLimit(process.env.REAL_SAMPLES_USD_PER_POINT);
  const volcUsdPerSecond = parsePositiveLimit(process.env.REAL_SAMPLES_VOLC_USD_PER_SECOND);
  const out = new Map<string, { unitPoints: number | null; unitUsd: number | null; note: string }>();
  for (const arm of arms) {
    if (arm.routeId === "volcengine_cn_legacy") {
      out.set(arm.id, {
        unitPoints: null,
        unitUsd: volcUsdPerSecond === null ? null : volcUsdPerSecond * durationSec,
        note: volcUsdPerSecond === null ? "缺 REAL_SAMPLES_VOLC_USD_PER_SECOND" : `$${volcUsdPerSecond}/s`,
      });
      continue;
    }
    try {
      const plan = await resolveShuyuVideoPlan({ planId: arm.planId });
      const unitPoints = shuyuVideoPlanPointsForDuration(plan, durationSec);
      out.set(arm.id, {
        unitPoints,
        unitUsd: usdPerPoint === null ? null : unitPoints * usdPerPoint,
        note: `${plan.planId} ${plan.resolution} ${plan.unitSalePoints}/${plan.billingUnit}`,
      });
    } catch (error) {
      out.set(arm.id, { unitPoints: null, unitUsd: null, note: (error as Error).message.slice(0, 160) });
    }
  }
  return out;
}

function spendLines(
  pending: ReadonlyArray<PendingRun>,
  pricing: Map<string, { unitPoints: number | null; unitUsd: number | null }>,
): SpendLine[] {
  return ARMS.map((arm) => ({
    armId: arm.id,
    count: pending.filter((run) => run.arm.id === arm.id).length,
    unitPoints: pricing.get(arm.id)?.unitPoints ?? null,
    unitUsd: pricing.get(arm.id)?.unitUsd ?? null,
  }));
}

function templateDurationSec(lockedParams: unknown): number {
  const duration = (lockedParams as { duration?: unknown } | null)?.duration;
  return typeof duration === "number" && duration > 0 ? duration : DEFAULT_DURATION_SEC;
}

async function main(): Promise<void> {
  if (CLI_ARGS.has("--help") || CLI_ARGS.has("-h")) {
    console.log(HELP);
    return;
  }
  assertRunKeyForArms(RUN_KEY, ARMS);
  applyRuntimeEnv();

  const report: Report = readReport() ?? {
    runKey: RUN_KEY,
    purpose: "template-library-expansion-samples",
    providerRoute: ARMS.map((arm) => arm.id).join(","),
    startedAt: new Date().toISOString(),
    productImages: {},
    items: [],
  };
  report.providerRoute = ARMS.map((arm) => arm.id).join(",");
  report.arms = ARMS;
  report.batchKeyRev = BATCH_KEY_REV;

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
      .map((item) => itemIdentity(item.slug, item.armId!)),
  );
  const pending: PendingRun[] = plan.flatMap((entry) =>
    ARMS.filter((arm) => !done.has(itemIdentity(entry.slug, arm.id))).map((arm) => ({ entry, arm })),
  );

  if (!CONFIRM_SPEND) {
    /// 干跑：不写报告、不生成参考图、不连库；只有 --live-price 才读一次 /prices。
    const pricing = LIVE_PRICE ? await priceArms(ARMS, DEFAULT_DURATION_SEC) : null;
    const estimate = pricing ? estimateSpend(spendLines(pending, pricing)) : null;
    console.log(
      JSON.stringify(
        {
          mode: "dry-plan",
          runKey: RUN_KEY,
          arms: ARMS.map((arm) => arm.id),
          experimentRun: isExperimentRun(ARMS),
          waveSize: WAVE_SIZE,
          batchKeyRev: BATCH_KEY_REV,
          refsReady: Object.fromEntries(
            Object.entries(report.productImages).map(([k, v]) => [k, v.length]),
          ),
          refImagesToGenerate: missingProductImageCount(report),
          pendingVideos: pending.map((run) => `${run.entry.slug} @ ${run.arm.id}`),
          pricing: pricing
            ? Object.fromEntries([...pricing.entries()].map(([armId, value]) => [armId, value]))
            : `未估价（加 --live-price 读一次 Shuyu /prices；按 ${DEFAULT_DURATION_SEC}s 估）`,
          estimate,
          hint: "REAL_SAMPLES_CONFIRM_SPEND=1 + REAL_SAMPLES_MAX_POINTS=<上限> 重新运行才会花钱",
        },
        null,
        2,
      ),
    );
    return;
  }

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

  /// 预算闸：按模板锁定时长 × 各臂实时单价逐条估算，过上限 / 余额预留线才花钱。
  const durations = [...new Set(pending.map((run) => templateDurationSec(templateBySlug.get(run.entry.slug)!.lockedParams)))];
  const pricingByDuration = new Map<number, Awaited<ReturnType<typeof priceArms>>>();
  for (const duration of durations) pricingByDuration.set(duration, await priceArms(ARMS, duration));
  const lines: SpendLine[] = pending.map((run) => {
    const duration = templateDurationSec(templateBySlug.get(run.entry.slug)!.lockedParams);
    const price = pricingByDuration.get(duration)!.get(run.arm.id)!;
    return { armId: run.arm.id, count: 1, unitPoints: price.unitPoints, unitUsd: price.unitUsd };
  });
  const estimate = estimateSpend(lines);
  const needsShuyu = estimate.totalPoints > 0;
  const availablePoints = needsShuyu ? (await getShuyuBalance()).available_points : null;
  const maxPoints = parsePositiveLimit(process.env.REAL_SAMPLES_MAX_POINTS);
  const maxUsd = parsePositiveLimit(process.env.REAL_SAMPLES_MAX_USD);
  const reservePoints =
    parsePositiveLimit(process.env.REAL_SAMPLES_RESERVE_POINTS) ?? SHUYU_RESERVE_POINTS_DEFAULT;
  report.budget = {
    at: new Date().toISOString(),
    estimate,
    availablePoints,
    maxPoints,
    maxUsd,
    reservePoints,
  };
  writeReport(report);
  console.log(
    `预估：${pending.length} 条，${estimate.totalPoints} 点${estimate.totalUsd ? ` / $${estimate.totalUsd}` : ""}；` +
      `余额 ${availablePoints ?? "—"}，上限 ${maxPoints ?? "—"} 点，预留线 ${reservePoints}`,
  );
  const gate = checkBudgetGate({ estimate, maxPoints, maxUsd, availablePoints, reservePoints });
  if (!gate.ok) throw new Error(`预算闸拒绝：\n  - ${gate.reasons.join("\n  - ")}`);

  await ensureProductImages(report);

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
    if (isCurrentRevKey(item.idempotencyKey)) continue;
    const cancelled = await cancelPendingBatchJobs(item.batchId);
    console.log(`cancelled stale batch ${item.batchId} (${item.slug} @ ${item.armId}): ${cancelled} jobs`);
  }
  report.items = report.items.filter(
    (item) => item.status === "SUCCEEDED" || isCurrentRevKey(item.idempotencyKey),
  );
  writeReport(report);

  /// 分波提交：一波建满立刻打到终态，再开下一波。
  /// timeoutAt 在批次创建时就定死，一次性全建会让队尾在拿到并发窗口前先过期。
  const waves: Array<PendingRun[]> = [];
  for (let i = 0; i < pending.length; i += WAVE_SIZE) {
    waves.push(pending.slice(i, i + WAVE_SIZE));
  }

  for (const [waveIndex, wave] of waves.entries()) {
    console.log(
      `wave ${waveIndex + 1}/${waves.length}: ${wave.map((w) => `${w.entry.slug}@${w.arm.id}`).join(", ")}`,
    );
    const waveItems: ReportItem[] = [];
    for (const { entry, arm } of wave) {
      const template = templateBySlug.get(entry.slug)!;
      const durationSec = templateDurationSec(template.lockedParams);
      const assets = report.productAssets?.[entry.set] ?? [];
      if (assets.length === 0) throw new Error(`产品集 ${entry.set} 没有已注册的参考资产`);
      /// 幂等键并入线路臂与（force 时的）模板版本：requestHash 含路由快照、套餐与
      /// templateVersion，同键换任一个都会被判重放冲突。
      const idempotencyKey = sampleIdempotencyKey({
        runKey: RUN_KEY,
        slug: entry.slug,
        armId: arm.id,
        force: FORCE_RERUN
          ? { templateVersion: template.version, retryRev: process.env.REAL_SAMPLES_RETRY_REV }
          : null,
      });
      const batch = await createBatchJob({
        userId: user.id,
        templateId: template.id,
        templateVersion: template.version,
        images: assets.slice(0, 4).map((asset) => ({ id: asset.id, url: asset.url })),
        requestedCount: 1,
        productName: PRODUCT_SETS[entry.set].productName,
        idempotencyKey,
        videoRouteId: arm.routeId,
        videoPlanId: arm.planId,
        isInternalStaff: true,
      });
      await authorizeBatchQuotaForSession(session, batch.id);
      const priorIndex = report.items.findIndex(
        (item) => item.slug === entry.slug && item.armId === arm.id,
      );
      const prior = priorIndex >= 0 ? report.items[priorIndex] : undefined;
      const sameBatch = prior?.batchId === batch.id;
      const estimated = pricingByDuration.get(durationSec)?.get(arm.id);
      const item: ReportItem = {
        ...(prior ?? {}),
        slug: entry.slug,
        set: entry.set,
        armId: arm.id,
        routeId: arm.routeId,
        planId: arm.planId,
        idempotencyKey,
        templateId: template.id,
        templateVersion: template.version,
        templateNameZh: template.nameZh,
        durationSec,
        batchId: batch.id,
        status: undefined,
        externalJobId: null,
        outputVideoUrl: null,
        error: null,
        /// 新批次 = 新成片：时间戳与人工 QA 清空；幂等命中同一批次（续跑）则保留。
        submittedAt: sameBatch ? prior?.submittedAt ?? null : null,
        firstProcessingAt: sameBatch ? prior?.firstProcessingAt ?? null : null,
        finishedAt: sameBatch ? prior?.finishedAt ?? null : null,
        costPoints: estimated?.unitPoints ?? null,
        costPointsSource: estimated?.unitPoints != null ? "estimate" : null,
        costUsd: estimated?.unitUsd ?? null,
        qa: sameBatch ? prior?.qa ?? emptyQa() : emptyQa(),
      };
      if (priorIndex >= 0) report.items[priorIndex] = item;
      else report.items.push(item);
      waveItems.push(item);
      writeReport(report);
    }

    const usdPerPoint = parsePositiveLimit(process.env.REAL_SAMPLES_USD_PER_POINT);
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
        if (job?.id) {
          /// 只读：时间戳与计价快照以库为准。
          const facts = await db.videoJob.findUnique({
            where: { id: job.id },
            select: {
              submittedAt: true,
              finishedAt: true,
              providerUnitPoints: true,
              providerUnitPriceUsd: true,
            },
          });
          Object.assign(
            item,
            advanceTiming(item, {
              now: new Date(),
              submittedAt: facts?.submittedAt ?? null,
              finishedAt: facts?.finishedAt ?? null,
              providerStatus: job.lastProviderStatus,
            }),
          );
          if (facts?.providerUnitPoints != null) {
            item.costPoints = facts.providerUnitPoints;
            item.costPointsSource = "snapshot";
            if (usdPerPoint !== null) item.costUsd = facts.providerUnitPoints * usdPerPoint;
          }
          if (facts?.providerUnitPriceUsd != null) item.costUsd = Number(facts.providerUnitPriceUsd);
        }
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
    const path = resolve(VIDEO_DIR, sampleVideoFileName(item.slug, item.armId!));
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
    plan.some((entry) => entry.slug === item.slug) && ARMS.some((arm) => arm.id === item.armId),
  );
  const failed = ranItems.filter((item) => item.status !== "SUCCEEDED");
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        succeeded: ranItems.length - failed.length,
        failed: failed.map((item) => ({ slug: item.slug, armId: item.armId, error: item.error })),
      },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 2;
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
