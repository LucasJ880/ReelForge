/**
 * Sunny Shutter 商家全流程 Mock（无浏览器）
 *
 * 模拟电商商家批量制作窗帘 TikTok 广告 → 录入流量 → 智能建议。
 * Run: npm run sunny:merchant-journey
 *
 * 前置：.env.local 数据库可用；建议 npm run dev:mock 后浏览器验收。
 */
import bcrypt from "bcryptjs";
import {
  AngleType,
  DeliveryOrderStatus,
  FinalVideoStatus,
  RoundStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "../src/lib/db";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import { mapPlanToDirectorPlan } from "../src/lib/video-generation/plan-to-director";
import {
  dispatchVideoForBrief,
  reconcileBriefRenderStatus,
} from "../src/lib/services/video-service";
import { importBusinessVideoMetrics } from "../src/lib/services/business-metrics-import";
import { loadBusinessInsights } from "../src/lib/services/business-insights-service";
import type { UnifiedVideoGenerationRequest } from "../src/types/video-generation";

process.env.LLM_FORCE_MOCK = "true";
process.env.VIDEO_ENGINE_MOCK = "true";
process.env.IMAGE_ENGINE_MOCK = "true";
process.env.VIDEO_ENGINE_MOCK_LATENCY_MS = "0";

const MERCHANT_EMAIL = "sunny-shutter@aivora.test";
const MERCHANT_PASSWORD = "testpass123";
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

const CURTAIN_ADS: Array<{
  label: string;
  title: string;
  rawPrompt: string;
  metrics: { views: number; completion_rate: number };
}> = [
  {
    label: "遮光帘 · 卧室清晨",
    title: "Sunny Shutter 遮光帘 — 卧室清晨竖屏广告",
    rawPrompt:
      "Sunny Shutter blackout curtains in a sunlit bedroom, 30s vertical TikTok ad, cozy morning light, pull-to-dark reveal, premium home decor, 9:16",
    metrics: { views: 12400, completion_rate: 0.48 },
  },
  {
    label: "纱帘 · 客厅自然光",
    title: "Sunny Shutter 纱帘 — 客厅自然光 TikTok 广告",
    rawPrompt:
      "Sunny Shutter sheer curtains in a modern living room, soft daylight, gentle breeze, 30s vertical ad for TikTok, elegant minimal style, 9:16",
    metrics: { views: 6200, completion_rate: 0.19 },
  },
];

const brandKit = {
  brandName: "Sunny Shutter",
  website: "https://sunnyshutter.example",
};

async function ensureMerchantUser() {
  let user = await db.adminUser.findUnique({ where: { email: MERCHANT_EMAIL } });
  if (!user) {
    user = await db.adminUser.create({
      data: {
        email: MERCHANT_EMAIL,
        hashedPassword: await bcrypt.hash(MERCHANT_PASSWORD, 10),
        name: "Sunny Shutter",
        role: "OPERATOR",
        userType: "BUSINESS",
      },
    });
  } else if (user.userType !== "BUSINESS") {
    user = await db.adminUser.update({
      where: { id: user.id },
      data: { userType: "BUSINESS", name: "Sunny Shutter" },
    });
  }
  return user;
}

async function persistAndDispatch(
  request: UnifiedVideoGenerationRequest,
  userId: string,
  orderTitle: string,
): Promise<{ briefId: string; orderId: string }> {
  const plan = await buildPlan(request);
  if (!plan.qualityReview.canDispatch) {
    const msgs = plan.qualityReview.blockers.map((b) => b.message).join("; ");
    throw new Error(`Plan blocked: ${msgs}`);
  }
  const directorPlanJson = mapPlanToDirectorPlan({ plan, language: "zh" });

  return db.$transaction(async (tx) => {
    const order = await tx.deliveryOrder.create({
      data: {
        title: orderTitle,
        status: DeliveryOrderStatus.ROUND_ACTIVE,
        productCategory: "curtains",
        targetPlatform: plan.inputClassification.targetPlatform,
        targetCountry: "US",
        targetLanguage: "zh",
        productInput: {
          source: "unified_input",
          userType: "business",
          rawPrompt: request.rawPrompt,
          brandKit: request.brandKit ?? null,
        } as object,
        maxRounds: 1,
        createdById: userId,
      },
    });
    const round = await tx.round.create({
      data: {
        deliveryOrderId: order.id,
        roundIndex: 1,
        status: RoundStatus.ANGLES_READY,
        optimizationSlots: 1,
        explorationSlots: 0,
        startedAt: new Date(),
      },
    });
    const angle = await tx.contentAngle.create({
      data: {
        roundId: round.id,
        sortOrder: 0,
        type: AngleType.OPTIMIZATION,
        title: plan.creativeBrief.hook.slice(0, 200) || orderTitle,
        hook: plan.creativeBrief.hook,
        narrative: plan.creativeBrief.narrative,
        localeNotes: { unifiedInputUserType: "business", merchant: "sunny-shutter" },
      },
    });
    const brief = await tx.videoBrief.create({
      data: {
        contentAngleId: angle.id,
        status: VideoBriefStatus.SCENE_PROMPT_READY,
        durationSec: request.selectedDuration,
        targetDurationSec: request.selectedDuration,
        aspectRatio: request.selectedAspectRatio,
        tone: plan.creativeBrief.emotionalAngle,
        directorPlan: directorPlanJson as object,
        videoGenerationPlan: plan as object,
        persona: "BUSINESS",
      },
    });
    return { briefId: brief.id, orderId: order.id };
  }).then(async (ids) => {
    await dispatchVideoForBrief(ids.briefId);
    return ids;
  });
}

async function waitUntilReady(label: string, briefId: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const summary = await reconcileBriefRenderStatus(briefId);
    const failed = summary.jobs.filter((j) => j.status === VideoJobStatus.FAILED);
    if (failed.length > 0) {
      throw new Error(`${label}: segment failed`);
    }
    const fv = summary.finalVideo;
    const allSegmentsOk =
      summary.succeeded === summary.totalJobs && summary.totalJobs > 0;
    if (allSegmentsOk && fv?.status === FinalVideoStatus.READY && summary.finalVideoUrl) {
      console.log(`  ✅ ${label} 成片就绪`);
      return;
    }
    if (allSegmentsOk && fv?.status === FinalVideoStatus.FAILED) {
      throw new Error(`${label}: 合成失败`);
    }
  }
  throw new Error(`${label}: 超时`);
}

function printBrowserWalkthrough(orderIds: string[]) {
  console.log("\n--- 浏览器验收路径（npm run dev:mock）---");
  console.log(`登录: ${MERCHANT_EMAIL} / ${MERCHANT_PASSWORD}`);
  console.log(`语言: 侧栏或设置切到「中文」\n`);
  const steps = [
    ["1. 创建广告", `${BASE_URL}/business/create-ad-video`],
    ["2. 产品库", `${BASE_URL}/business/products`],
    ["3. 集成 · 录入 TikTok", `${BASE_URL}/business/integrations`],
    ["4. 表现数据", `${BASE_URL}/business/performance`],
    ["5. 智能建议", `${BASE_URL}/business/recommendations`],
    ["6. 创意工作室", `${BASE_URL}/business/creative-studio`],
  ];
  for (const [name, url] of steps) {
    console.log(`  ${name}: ${url}`);
  }
  if (orderIds[0]) {
    console.log(
      `  变体预填: ${BASE_URL}/business/create-ad-video?from=${encodeURIComponent(orderIds[0])}`,
    );
  }
}

async function main() {
  console.log("=== Sunny Shutter 商家旅程 (mock) ===\n");
  const user = await ensureMerchantUser();
  const created: Array<{ label: string; briefId: string; orderId: string }> = [];

  for (const ad of CURTAIN_ADS) {
    console.log(`\n▶ 生成: ${ad.label}`);
    const request: UnifiedVideoGenerationRequest = {
      userType: "business",
      rawPrompt: ad.rawPrompt,
      attachments: [],
      selectedDuration: 30,
      selectedAspectRatio: "9:16",
      selectedBrandEndingMode: "auto_end_card",
      cta: "立即选购",
      platform: "tiktok",
      brandKit,
      language: "zh",
    };
    const { briefId, orderId } = await persistAndDispatch(request, user.id, ad.title);
    await waitUntilReady(ad.label, briefId);
    created.push({ label: ad.label, briefId, orderId });
  }

  console.log("\n▶ 模拟 TikTok 流量录入…");
  for (let i = 0; i < created.length; i++) {
    const ad = CURTAIN_ADS[i];
    const row = created[i];
    await importBusinessVideoMetrics({
      userId: user.id,
      briefId: row.briefId,
      windowHours: 24,
      metrics: {
        views: ad.metrics.views,
        completion_rate: ad.metrics.completion_rate,
        likes: Math.round(ad.metrics.views * 0.04),
        shares: Math.round(ad.metrics.views * 0.008),
      },
      publishUrl: `https://www.tiktok.com/@sunnyshutter/video/mock-${row.orderId.slice(0, 8)}`,
    });
    console.log(
      `  ${ad.label}: ${ad.metrics.views.toLocaleString()} 播放 · 完播 ${Math.round(ad.metrics.completion_rate * 100)}%`,
    );
  }

  const insights = await loadBusinessInsights(user.id, "zh-CN");
  console.log("\n▶ 智能建议（zh-CN）:");
  if (insights.recommendations.length === 0) {
    console.log("  （无建议 — 检查 metrics 是否写入）");
  } else {
    for (const rec of insights.recommendations) {
      console.log(`\n  [${rec.priority}] ${rec.title}`);
      console.log(`  ${rec.body}`);
      console.log(`  → ${rec.actionLabel}: ${rec.actionHref}`);
    }
  }

  printBrowserWalkthrough(created.map((c) => c.orderId));
  console.log("\n✅ Sunny Shutter 商家旅程完成");
}

main()
  .catch((err) => {
    console.error("\n❌ Sunny Shutter 商家旅程失败:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
