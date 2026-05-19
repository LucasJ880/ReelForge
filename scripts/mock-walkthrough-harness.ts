/**
 * Mock 双端 walkthrough 自动化（无浏览器）。
 *
 * 覆盖 MANUAL_WALKTHROUGH §1（C 15s）与 §3（B 30s + end card）。
 * Run: npm run walkthrough:mock
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
import type { UnifiedVideoGenerationRequest } from "../src/types/video-generation";
import { deriveBusinessOrderTitle } from "../src/lib/video-generation/business-display-title";

process.env.LLM_FORCE_MOCK = "true";
process.env.VIDEO_ENGINE_MOCK = "true";
process.env.IMAGE_ENGINE_MOCK = "true";
process.env.VIDEO_ENGINE_MOCK_LATENCY_MS = "0";

const HARNESS_EMAIL = "mock-walkthrough@aivora.test";

async function ensureHarnessUser() {
  let user = await db.adminUser.findUnique({ where: { email: HARNESS_EMAIL } });
  if (!user) {
    user = await db.adminUser.create({
      data: {
        email: HARNESS_EMAIL,
        hashedPassword: await bcrypt.hash("testpass123", 10),
        name: "Mock Walkthrough",
        role: "OPERATOR",
        userType: "PERSONAL",
      },
    });
  }
  return user;
}

async function persistAndDispatch(
  request: UnifiedVideoGenerationRequest,
  userId: string,
): Promise<string> {
  const plan = await buildPlan(request);
  if (!plan.qualityReview.canDispatch) {
    const msgs = plan.qualityReview.blockers.map((b) => b.message).join("; ");
    throw new Error(`Plan blocked: ${msgs}`);
  }
  const directorPlanJson = mapPlanToDirectorPlan({ plan, language: "en" });
  const persona = request.userType === "business" ? "BUSINESS" : "PERSONAL";

  const { briefId } = await db.$transaction(async (tx) => {
    const orderTitle =
      request.userType === "business"
        ? deriveBusinessOrderTitle({
            rawPrompt: request.rawPrompt,
            language: request.language,
            brandKit: request.brandKit,
            durationSec: request.selectedDuration,
            platform: request.platform,
          })
        : request.rawPrompt.slice(0, 120) || "Harness video";

    const order = await tx.deliveryOrder.create({
      data: {
        title: orderTitle,
        status: DeliveryOrderStatus.ROUND_ACTIVE,
        productCategory: "unified_input",
        targetPlatform: plan.inputClassification.targetPlatform,
        targetCountry: "US",
        targetLanguage: "en",
        productInput: {
          source: "unified_input",
          userType: request.userType,
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
        title: plan.creativeBrief.hook.slice(0, 200) || "Harness angle",
        hook: plan.creativeBrief.hook,
        narrative: plan.creativeBrief.narrative,
        localeNotes: { unifiedInputUserType: request.userType },
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
        persona,
      },
    });
    return { briefId: brief.id };
  });

  await dispatchVideoForBrief(briefId);
  return briefId;
}

async function waitUntilReady(label: string, briefId: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const summary = await reconcileBriefRenderStatus(briefId);
    const failed = summary.jobs.filter((j) => j.status === VideoJobStatus.FAILED);
    if (failed.length > 0) {
      console.error(`  ${label} failed jobs:`, failed.map((j) => j.userSafeError ?? j.debug.adminError));
      throw new Error(`${label}: segment generation failed`);
    }
    const fv = summary.finalVideo;
    const allSegmentsOk =
      summary.succeeded === summary.totalJobs && summary.totalJobs > 0;
    console.log(
      `  tick ${i}: segments ${summary.succeeded}/${summary.totalJobs}, finalVideo=${fv?.status ?? "n/a"}`,
    );
    if (allSegmentsOk && fv?.status === FinalVideoStatus.READY && summary.finalVideoUrl) {
      console.log(`  ✅ ${label} ready`);
      return;
    }
    if (allSegmentsOk && fv?.status === FinalVideoStatus.FAILED) {
      throw new Error(`${label}: stitch failed — ${fv.ffmpegError ?? "unknown"}`);
    }
  }
  throw new Error(`${label}: timeout (40 ticks)`);
}

async function main() {
  console.log("=== Mock walkthrough harness ===\n");
  const user = await ensureHarnessUser();

  const personalReq: UnifiedVideoGenerationRequest = {
    userType: "personal",
    rawPrompt: "a cat exploring a sunny apartment in vertical 9:16",
    attachments: [],
    selectedDuration: 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "none",
    cta: null,
    platform: null,
    brandKit: null,
    language: null,
  };

  console.log("C端 15s personal…");
  const personalBriefId = await persistAndDispatch(personalReq, user.id);
  await waitUntilReady("C端 personal", personalBriefId);

  const businessReq: UnifiedVideoGenerationRequest = {
    userType: "business",
    rawPrompt:
      "Sunny Shutter blackout curtains, cozy bedroom morning light, 30s vertical TikTok ad, 9:16",
    attachments: [],
    selectedDuration: 30,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "auto_end_card",
    cta: "Shop curtains",
    platform: "tiktok",
    brandKit: { brandName: "Sunny Shutter", website: "https://sunnyshutter.example" },
    language: null,
  };

  console.log("\nB端 30s business + end card…");
  const businessBriefId = await persistAndDispatch(businessReq, user.id);
  await waitUntilReady("B端 business", businessBriefId);

  console.log("\n✅ Mock walkthrough harness: C + B 全链路通过");
}

main()
  .catch((err) => {
    console.error("\n❌ Mock walkthrough harness failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
