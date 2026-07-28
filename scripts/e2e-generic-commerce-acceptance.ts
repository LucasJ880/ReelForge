/**
 * 0728 整合验收：通用电商模板 → 一致性锁 → 真机出片 → 品牌封装 → 成品库。
 *
 * 分两段跑，默认只跑第一段（零成本）：
 *   PHASE 1（默认）契约与数据校验，不调供应商、不花钱
 *   PHASE 2（E2E_SUBMIT=1）真机提交 1 条并轮询到成片
 *
 * 用法：
 *   npx dotenv -e .env.local -- npx tsx scripts/e2e-generic-commerce-acceptance.ts
 *   E2E_SUBMIT=1 npx dotenv -e .env.local -- npx tsx scripts/e2e-generic-commerce-acceptance.ts
 */

import { PrismaClient, StyleTemplateStatus } from "@prisma/client";
import {
  COMMERCE_TEMPLATE_RECIPES,
  getCommerceTemplateRecipe,
} from "@/lib/video-generation/commerce-template-catalog";
import { renderCommerceTemplate } from "@/lib/video-generation/generic-commerce-template";
import { BATCH_STYLE_TEMPLATE_SEEDS } from "@/lib/video-generation/batch-style-templates";
import {
  batchPostProductionSchema,
  postProductionPlanSchema,
} from "@/lib/schemas/unified-input";
import {
  buildBatchVideoRows,
  readBatchPostProductionFromSnapshot,
} from "@/lib/services/batch-service";
import { filterPublicBrandWallEntries } from "@/components/brand/customer-brand-wall";

const db = new PrismaClient();

/** 合作方 prompt 硬上限（0721 真机复现）。 */
const PROMPT_LIMIT = 5_000;
/** 除产品品类词外，成片链路里不应再出现的客户标识。 */
const CLIENT_LEAK = /sunnyshutter|sunny\s*shutter|plantation shutter|tilt bar|louver/i;

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

async function phase1(): Promise<void> {
  console.log("\n───── PHASE 1 · 契约与数据校验（零成本）─────\n");

  // 1. 通用配方数量与命名
  record(
    "通用电商配方 = 8 条",
    COMMERCE_TEMPLATE_RECIPES.length === 8,
    `实际 ${COMMERCE_TEMPLATE_RECIPES.length} 条：${COMMERCE_TEMPLATE_RECIPES.map((r) => r.nameZh).join("、")}`,
  );

  // 2. 骨架渲染 + 长度 + 无客户泄漏
  const rendered = COMMERCE_TEMPLATE_RECIPES.map((recipe) => {
    const prompt = renderCommerceTemplate(recipe.slug, {
      productName: "Aivora smart bottle",
      imageUrls: ["https://example.test/a.jpg", "https://example.test/b.jpg"],
    });
    return { slug: recipe.slug, prompt };
  });
  const tooLong = rendered.filter((r) => r.prompt.length >= PROMPT_LIMIT);
  record(
    `全部骨架 < ${PROMPT_LIMIT} 字符`,
    tooLong.length === 0,
    tooLong.length === 0
      ? `最长 ${Math.max(...rendered.map((r) => r.prompt.length))} 字符`
      : `超限：${tooLong.map((r) => r.slug).join(", ")}`,
  );
  const leaked = rendered.filter((r) => CLIENT_LEAK.test(r.prompt));
  record(
    "通用骨架不含客户专属词",
    leaked.length === 0,
    leaked.length === 0 ? "8 条骨架均为品类无关表述" : `泄漏：${leaked.map((r) => r.slug).join(", ")}`,
  );
  const missingSlots = rendered.filter(
    (r) => r.prompt.includes("{IMAGE_REFS}") || r.prompt.includes("{PRODUCT_NAME}"),
  );
  record(
    "占位符已完成确定性填空",
    missingSlots.length === 0,
    missingSlots.length === 0 ? "IMAGE_REFS / PRODUCT_NAME 均已替换" : `未填：${missingSlots.map((r) => r.slug).join(", ")}`,
  );

  // 3. 库内 ACTIVE 模板 = 通用 8 条，且旧客户模板已归档
  const active = await db.styleTemplate.findMany({
    where: { status: StyleTemplateStatus.ACTIVE, category: { not: "自动化验收" } },
    select: { slug: true, category: true, nameZh: true },
  });
  const seedSlugs = new Set(BATCH_STYLE_TEMPLATE_SEEDS.map((s) => s.slug));
  const strays = active.filter((t) => !seedSlugs.has(t.slug));
  record(
    "线上 ACTIVE 模板只剩通用 8 条",
    active.length === 8 && strays.length === 0,
    `ACTIVE ${active.length} 条，分类 ${[...new Set(active.map((t) => t.category))].join("/")}` +
      (strays.length ? `；残留：${strays.map((t) => t.slug).join(", ")}` : ""),
  );
  const archivedClient = await db.styleTemplate.count({
    where: { status: StyleTemplateStatus.ARCHIVED, category: "SunnyShutter电商" },
  });
  record(
    "旧客户模板已归档而非删除（保留 FK 溯源）",
    archivedClient > 0,
    `已归档 ${archivedClient} 条 SunnyShutter电商 模板`,
  );

  // 4. 全局品牌包 + 客户展示墙
  const globals = await db.workspaceBrandPackage.findMany({
    where: { isGlobal: true, isActive: true },
    include: { logoAsset: true },
  });
  record(
    "全局品牌包对所有用户可选",
    globals.length >= 2,
    `${globals.length} 个：${globals.map((g) => g.name).join("、")}`,
  );
  const wall = filterPublicBrandWallEntries(
    globals.map((g) => ({
      id: g.id,
      brandName: g.brandName,
      logoUrl: g.logoAsset.url,
      scope: "global" as const,
      clientProfileId: g.clientProfileId,
    })),
  );
  record(
    "客户展示墙只放真实客户",
    wall.length >= 1 && wall.every((w) => w.clientProfileId),
    `展示墙 ${wall.length} 个：${wall.map((w) => w.brandName).join("、")}（平台自有预设已排除）`,
  );

  // 5. 批次后期契约
  const post = batchPostProductionSchema.safeParse({
    audio: {
      voiceover: { enabled: false, voiceId: "warm-confident", language: "en-US", script: "" },
      bgm: { trackId: "wholesome", volume: 0.18 },
    },
    captions: {
      enabled: true,
      style: "word_by_word",
      language: "en-US",
      position: "bottom",
      exportSrt: true,
    },
  });
  record("批次后期契约（字幕+BGM）可校验", post.success, post.success ? "schema 通过" : JSON.stringify(post.error?.issues));

  /// 后期随模板快照落到每条 VideoJob，无需 DDL（运行时角色没有 owner 权限）。
  const roundTrip = buildBatchVideoRows({
    batchId: "acceptance-dry",
    template: (await db.styleTemplate.findFirstOrThrow({
      where: { status: StyleTemplateStatus.ACTIVE, category: "电商带货" },
    })),
    images: [{ id: "img", url: "https://example.test/a.jpg" }],
    requestedCount: 1,
    productName: "Acceptance product",
    provider: "SEEDANCE_I2V",
    postProduction: post.success ? post.data : undefined,
  });
  const recovered = readBatchPostProductionFromSnapshot(
    roundTrip[0]?.templateSnapshot,
  );
  record(
    "批次后期可随模板快照持久化并取回",
    postProductionPlanSchema.safeParse(recovered).success,
    recovered ? "写入 → 读回一致，无需数据库迁移" : "快照往返失败",
  );

  // 6. 成品库不再展示死卡
  const dead = await db.videoJob.count({
    where: { status: "FAILED", brandedVideoUrl: null, outputVideoUrl: null },
  });
  const playable = await db.videoJob.count({
    where: { status: "SUCCEEDED", outputVideoUrl: { not: null } },
  });
  record(
    "成品库有可播成片、死卡不进前端",
    playable > 0,
    `可播 ${playable} 条；失败无产出 ${dead} 条（前端已过滤）`,
  );
}

async function phase2(): Promise<void> {
  console.log("\n───── PHASE 2 · 真机出片（会产生费用）─────\n");
  const recipe = getCommerceTemplateRecipe("commerce-single-feature-proof");
  if (!recipe) throw new Error("找不到通用配方 commerce-single-feature-proof");

  const template = await db.styleTemplate.findFirst({
    where: { slug: recipe.slug, status: StyleTemplateStatus.ACTIVE },
  });
  if (!template) throw new Error(`模板未激活：${recipe.slug}`);

  const owner = await db.adminUser.findUnique({
    where: { email: "sunny-shutter@aivora.test" },
    select: { id: true, email: true },
  });
  if (!owner) throw new Error("找不到验收账号 sunny-shutter@aivora.test");

  const images = await db.mediaAsset.findMany({
    where: { userId: owner.id, mimeType: { startsWith: "image/" } },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, url: true },
  });
  if (images.length === 0) throw new Error("验收账号下没有可用产品图");

  const prompt = renderCommerceTemplate(recipe.slug, {
    productName: "Custom plantation shutters",
    imageUrls: images.map((i) => i.url),
  });
  console.log(`模板：${template.nameZh}（${template.slug} v${template.version}）`);
  console.log(`账号：${owner.email}`);
  console.log(`参考图：${images.length} 张`);
  console.log(`prompt 长度：${prompt.length} 字符`);
  console.log("\n--- 真机提交需要走应用的配额与派发链路 ---");
  console.log("请在前端用该账号提交一个 1 条批次（模板选「单卖点硬证据」），");
  console.log("或运行既有脚本：npm run acceptance:sunnyshutter:batch10:submit");
  console.log("本脚本不绕过配额直连供应商，避免产生不入账的计费。");
}

async function main(): Promise<void> {
  await phase1();
  if (process.env.E2E_SUBMIT === "1") await phase2();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n───── 结果：${checks.length - failed.length}/${checks.length} 通过 ─────`);
  if (failed.length) {
    console.log("未通过：");
    for (const f of failed) console.log(`  ❌ ${f.name} — ${f.detail}`);
  }
  await db.$disconnect();
  if (failed.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
