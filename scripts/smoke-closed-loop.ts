/**
 * 端到端冒烟（直调 service 层，不起 HTTP server）
 *
 * 验证链路：
 *   1. 创建 DeliveryOrder（真实 Neon）
 *   2. 调 discovery-service（真实 OpenAI + 真实 Apify 抓 TikTok 信号）
 *   3. 调 selling-point-service（真实 OpenAI）
 *   4. 开第一轮 Round（round-service）
 *   5. 生成 5 条 Angle（真实 OpenAI）
 *   6. 对第 1 条 angle 生成脚本 → 分镜 → prompt（真实 OpenAI）
 *   7. 触发视频渲染（Seedance；默认 mock 避免烧 token）
 *   8. AI QA 初审（真实 OpenAI）
 *
 * 运行方式：
 *   VIDEO_ENGINE_MOCK=true npx tsx scripts/smoke-closed-loop.ts
 *
 * 想跑真实视频生成（~$1/次）：
 *   VIDEO_ENGINE_MOCK=false npx tsx scripts/smoke-closed-loop.ts
 */
import { PrismaClient } from "@prisma/client";
import { startMarketResearch } from "../src/lib/services/discovery-service";
import { extractSellingPoints } from "../src/lib/services/selling-point-service";
import { createRound } from "../src/lib/services/round-service";
import { generateAnglesForRound } from "../src/lib/services/angle-service";
import { ensureBriefsForRound } from "../src/lib/services/brief-service";
import { generateScriptForBrief } from "../src/lib/services/script-service";
import { generateScenesForBrief } from "../src/lib/services/scene-service";
import { generatePromptsForBrief } from "../src/lib/services/prompt-service";
import {
  dispatchVideoGeneration,
  pollRunningJobs,
  syncBriefStatus,
} from "../src/lib/services/video-service";
import { runAIQA } from "../src/lib/services/qa-service";

const db = new PrismaClient();

function banner(title: string) {
  console.log("\n" + "=".repeat(70));
  console.log("  " + title);
  console.log("=".repeat(70));
}

async function main() {
  banner("Step 0: 准备 Admin 用户 + 清理旧冒烟数据");
  const admin = await db.adminUser.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!admin) throw new Error("没有 SUPER_ADMIN，先跑 npm run db:seed");
  console.log("Admin:", admin.email);

  await db.deliveryOrder.deleteMany({
    where: { title: { startsWith: "[smoke]" } },
  });

  banner("Step 1: 创建真实毛毯 DeliveryOrder");
  const order = await db.deliveryOrder.create({
    data: {
      title: `[smoke] Microfiber Blanket · ${new Date().toISOString().slice(0, 16)}`,
      productCategory: "blanket",
      targetPlatform: "tiktok",
      targetCountry: "US",
      targetLanguage: "en",
      targetRegionVariant: "en-US",
      maxRounds: 3,
      status: "DRAFT",
      createdById: admin.id,
      productInput: {
        sku: "BLK-2026-SOFT",
        material: "Microfiber Flannel",
        size: "50x60 inch",
        gsm: 330,
        price_usd: 29.99,
        hint: "主打亲肤 + 沙发/睡前 + 情侣场景",
        image_urls: [] as string[],
        search_keywords: ["cozy blanket", "soft blanket", "tiktok blanket"],
      },
    },
  });
  console.log("Created order:", order.id);

  banner("Step 2: discovery-service（真实 OpenAI + Apify）");
  const t0 = Date.now();
  await startMarketResearch(order.id);
  const research = await db.marketResearch.findUnique({
    where: { deliveryOrderId: order.id },
  });
  console.log(`耗时 ${(Date.now() - t0) / 1000}s`);
  console.log("status:", research?.status);
  console.log("debug:", research?.debug);
  const structured = research?.structured as Record<string, unknown> | null;
  console.log("keywords:", (structured?.keywords as string[] | undefined)?.slice(0, 8));
  console.log("hot_hooks[0..3]:", (structured?.hot_hooks as string[] | undefined)?.slice(0, 3));
  console.log("pain_points[0..5]:", (structured?.pain_points as string[] | undefined)?.slice(0, 5));

  banner("Step 3: selling-point-service");
  await extractSellingPoints(order.id);
  const sps = await db.sellingPoint.findMany({
    where: { deliveryOrderId: order.id },
    orderBy: { rank: "asc" },
  });
  console.log(`共 ${sps.length} 条卖点：`);
  for (const sp of sps) {
    console.log(`  [${sp.kind}#${sp.rank}] ${sp.title} — ${sp.body.slice(0, 80)}`);
  }

  banner("Step 4: 开第一轮 Round");
  const round = await createRound({ deliveryOrderId: order.id });
  console.log("Round:", round.id, "roundIndex =", round.roundIndex);

  banner("Step 5: 生成 5 条 Angle（真实 OpenAI）+ 自动建 Brief");
  await generateAnglesForRound({ roundId: round.id });
  await ensureBriefsForRound(round.id);
  const angles = await db.contentAngle.findMany({
    where: { roundId: round.id },
    orderBy: { sortOrder: "asc" },
    include: { videoBrief: true },
  });
  console.log(`共 ${angles.length} 条 angle：`);
  for (const a of angles) {
    console.log(`  #${a.sortOrder} [${a.type}] ${a.title}`);
    if (a.hook) console.log(`         hook: ${a.hook.slice(0, 100)}`);
  }
  const optCount = angles.filter((a) => a.type === "OPTIMIZATION").length;
  const expCount = angles.filter((a) => a.type === "EXPLORATION").length;
  console.log(`分布：OPTIMIZATION=${optCount}, EXPLORATION=${expCount}（应为 3/2）`);
  if (optCount !== 3 || expCount !== 2) {
    throw new Error("赛马配比校验失败");
  }

  banner("Step 6: 第一条 angle 跑 script + scene + prompt");
  const firstAngle = angles[0];
  if (!firstAngle.videoBrief) throw new Error("Angle 没自动建 brief");
  const briefId = firstAngle.videoBrief.id;

  console.log("  → generateScript");
  await generateScriptForBrief(briefId);
  console.log("  → generateScenes");
  await generateScenesForBrief(briefId);
  console.log("  → generatePrompts");
  await generatePromptsForBrief(briefId);

  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      scripts: {
        where: { isCurrent: true },
        include: {
          scenePlans: {
            orderBy: { sceneIndex: "asc" },
            include: { videoPrompts: true },
          },
        },
      },
    },
  });
  const script = brief?.scripts[0];
  console.log("Script v" + script?.version + " 字数:", script?.fullText.length);
  console.log("Scenes:", script?.scenePlans.length);
  console.log("Prompts per scene:", script?.scenePlans.map((s) => s.videoPrompts.length));

  banner("Step 7: 触发 Seedance（mock=" + (process.env.VIDEO_ENGINE_MOCK !== "false") + "）");
  process.env.VIDEO_ENGINE_MOCK = process.env.VIDEO_ENGINE_MOCK ?? "true";
  await dispatchVideoGeneration(briefId);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await pollRunningJobs(10);
    await syncBriefStatus(briefId);
    const current = await db.videoBrief.findUnique({ where: { id: briefId } });
    console.log(`  poll#${i + 1} brief=${current?.status}  jobs polled=${r.polled} updated=${r.updated}`);
    if (
      current?.status === "QA_PENDING" ||
      current?.status === "RENDER_FAILED" ||
      current?.status === "RENDER_SUCCEEDED"
    ) {
      break;
    }
  }

  banner("Step 8: AI QA 初审（真实 OpenAI）");
  const qa = await runAIQA(briefId);
  console.log("QA overall:", qa.aiOverallScore, "route:", qa.aiReviewRoute);
  console.log("issues:", qa.aiIssues);

  banner("冒烟完成 ✓");
  console.log("Delivery order:", order.id);
  console.log("Round:", round.id);
  console.log("Brief:", briefId);
  console.log("去 /orders/" + order.id + " 看前端效果");
}

main()
  .catch((e) => {
    console.error("冒烟失败：", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
