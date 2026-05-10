/**
 * Wizard Release Smoke Script (Phase 4 / B3)
 *
 * 不依赖 OpenAI / Vercel Blob / FFmpeg —— 强制走 mock / DRAFT / MOCK 路径，
 * 端到端验证 wizard 1→6 在部署环境最少能跑通。
 *
 * 用法：
 *   npm run smoke:wizard
 *   npm run smoke:wizard -- --cleanup            # 跑完后删除创建的测试 DeliveryOrder
 *   npm run smoke:wizard -- --allow-production   # 强制允许在 production 跑（默认拒绝）
 *
 * 期望结果：
 * - 创建一个 DeliveryOrder + ClientBrief
 * - 选 1 张 PUBLISHED CreativeEvidenceCard（找不到则跳过 select 步骤但继续）
 * - 生成 mock script（Script.metadata 写入完整 ScriptOutput）
 * - 生成 mock storyboard + shooting guide（写入 N 个 ScenePlan）
 * - 注册 1 条 mock public-URL asset（Phase 4 不打 Blob，公网 URL 即可）
 * - 触发 createAndRunWizardRender → DRAFT_READY 或 MOCK
 * - 输出 IDs，pass/fail 由 evaluateSmokeResult 决定
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

/// 强制 mock 路径 —— 即便本地配置了 KEY 也走 mock，确保 smoke 结果可复现
delete process.env.OPENAI_API_KEY;
process.env.ENABLE_WIZARD_FFMPEG_RENDER = "false";

import { db } from "../src/lib/db";
import { initClientProject } from "../src/lib/services/client-project-service";
import { selectCreativeCard } from "../src/lib/services/client-project-service";
import { generateAndPersistWizardScript } from "../src/lib/services/wizard-script-service";
import { generateAndPersistWizardStoryboard } from "../src/lib/services/wizard-storyboard-service";
import { registerWizardAsset } from "../src/lib/services/wizard-asset-service";
import { createAndRunWizardRender } from "../src/lib/services/wizard-render-service";
import {
  evaluateSmokeResult,
  parseSmokeArgs,
  shouldRefuseDueToProduction,
  type SmokeStepResult,
  type SmokeWizardResult,
} from "../src/lib/services/wizard-smoke-helpers";
import type { ClientBrief } from "../src/lib/schemas/client-brief";

const SMOKE_BRIEF: ClientBrief = {
  businessName: `[Smoke] Wizard Release ${new Date().toISOString()}`,
  industry: "real_estate",
  objective: "promote_listing",
  targetPlatforms: ["tiktok"],
  videoLengthSec: 30,
  brandTone: "professional",
  brandAssets: { ctaText: "DM us today" },
  candidateCardSlugs: [],
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
};

/// 用一个公开稳定的 mp4 URL 做 asset 注册测试（Asset QA 不会请求该 URL，仅做 schema/规则校验）。
const SMOKE_ASSET_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

async function main() {
  const args = parseSmokeArgs(process.argv.slice(2));
  const guard = shouldRefuseDueToProduction({
    nodeEnv: process.env.NODE_ENV,
    allowProduction: args.allowProduction,
  });
  if (guard.refuse) {
    console.error("✋", guard.reason);
    process.exit(2);
  }

  const steps: SmokeStepResult[] = [];
  const result: SmokeWizardResult = {
    orderId: null,
    scriptId: null,
    scenePlanIds: [],
    rawAssetIds: [],
    renderJobId: null,
    renderJobStatus: null,
    renderJobMode: null,
    steps,
  };

  try {
    /// 1. createOrder
    try {
      const order = await initClientProject({
        title: SMOKE_BRIEF.businessName,
        brief: SMOKE_BRIEF,
      });
      result.orderId = order.id;
      steps.push({ name: "createOrder", status: "ok", detail: order.id });
      console.log(`✓ createOrder · ${order.id}`);
    } catch (err) {
      steps.push({ name: "createOrder", status: "failed", detail: (err as Error).message });
      throw err;
    }

    /// 2. selectCard（找不到 PUBLISHED 卡时跳过，仅警告，不算 fail）
    const card = await db.creativeEvidenceCard.findFirst({
      where: { status: "PUBLISHED", industry: "real_estate" },
      orderBy: { recommendationScore: "desc" },
    });
    if (card) {
      try {
        await selectCreativeCard(result.orderId!, card.slug);
        steps.push({ name: "selectCard", status: "ok", detail: card.slug });
        console.log(`✓ selectCard · ${card.slug}`);
      } catch (err) {
        steps.push({ name: "selectCard", status: "failed", detail: (err as Error).message });
      }
    } else {
      steps.push({
        name: "selectCard",
        status: "skipped",
        detail: "无 PUBLISHED real_estate 卡（先运行 npm run db:seed:creative-cards）",
      });
      console.log(`- selectCard · skipped (no PUBLISHED real_estate card)`);
    }

    /// 3. generateScript（mock）
    try {
      const sc = await generateAndPersistWizardScript({
        deliveryOrderId: result.orderId!,
      });
      result.scriptId = sc.scriptId;
      steps.push({
        name: "generateScript",
        status: "ok",
        detail: `${sc.scriptId} · fromMock=${sc.fromMock}`,
      });
      console.log(`✓ generateScript · ${sc.scriptId} (fromMock=${sc.fromMock})`);
    } catch (err) {
      steps.push({ name: "generateScript", status: "failed", detail: (err as Error).message });
      throw err;
    }

    /// 4. generateStoryboard（mock）
    try {
      const sb = await generateAndPersistWizardStoryboard({
        deliveryOrderId: result.orderId!,
      });
      result.scenePlanIds = sb.scenePlanIds;
      steps.push({
        name: "generateStoryboard",
        status: "ok",
        detail: `${sb.scenePlanIds.length} shots · fromMock=${sb.fromMock}`,
      });
      console.log(`✓ generateStoryboard · ${sb.scenePlanIds.length} shots (fromMock=${sb.fromMock})`);
    } catch (err) {
      steps.push({ name: "generateStoryboard", status: "failed", detail: (err as Error).message });
      throw err;
    }

    /// 5. registerAsset（公网 URL；不依赖 Blob）
    try {
      const asset = await registerWizardAsset({
        deliveryOrderId: result.orderId!,
        input: {
          type: "VIDEO",
          url: SMOKE_ASSET_URL,
          name: "smoke-asset.mp4",
          mimeType: "video/mp4",
        },
      });
      result.rawAssetIds = [asset.id];
      steps.push({
        name: "registerAsset",
        status: "ok",
        detail: `${asset.id} · qa=${asset.qaStatus}`,
      });
      console.log(`✓ registerAsset · ${asset.id} (qa=${asset.qaStatus})`);
    } catch (err) {
      steps.push({ name: "registerAsset", status: "failed", detail: (err as Error).message });
      /// asset 失败不算阻断（部署环境不一定能访问公网）
      console.warn(`! registerAsset failed (non-blocking): ${(err as Error).message}`);
    }

    /// 6. createRender（必然 DRAFT 或 MOCK，因为 ENABLE_WIZARD_FFMPEG_RENDER=false）
    try {
      const job = await createAndRunWizardRender({
        deliveryOrderId: result.orderId!,
      });
      result.renderJobId = job.id;
      result.renderJobStatus = job.status;
      result.renderJobMode = job.mode;
      steps.push({
        name: "createRender",
        status: "ok",
        detail: `${job.id} · mode=${job.mode} · status=${job.status}`,
      });
      console.log(`✓ createRender · ${job.id} mode=${job.mode} status=${job.status}`);
    } catch (err) {
      steps.push({ name: "createRender", status: "failed", detail: (err as Error).message });
      throw err;
    }
  } catch (err) {
    console.error("Smoke aborted:", (err as Error).message);
  }

  /// 总评 & 输出
  console.log("\n=== Smoke Result ===");
  console.log(JSON.stringify(result, null, 2));
  const verdict = evaluateSmokeResult(result);
  if (verdict.ok) {
    console.log("\n✅ Wizard release smoke: PASS");
  } else {
    console.error("\n❌ Wizard release smoke: FAIL");
    for (const b of verdict.blockers) console.error(`  - ${b}`);
  }

  /// 可选清理
  if (args.cleanup && result.orderId) {
    console.log(`\nCleanup: deleting DeliveryOrder ${result.orderId} ...`);
    /// 级联删除靠 Prisma onDelete: Cascade（DeliveryOrder → Round/RawAsset/...）
    await db.deliveryOrder.delete({ where: { id: result.orderId } }).catch((e) => {
      console.error("  cleanup failed:", e.message);
    });
    console.log("Cleanup done.");
  } else if (result.orderId) {
    console.log(`\n(留下了 DeliveryOrder ${result.orderId} 供你浏览；下次跑可加 --cleanup 清理)`);
  }

  await db.$disconnect();
  process.exit(verdict.ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("fatal:", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
