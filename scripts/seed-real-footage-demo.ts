import { loadEnvConfig } from "@next/env";
import { Prisma, RawAssetType } from "@prisma/client";
import { db } from "../src/lib/db";
import { generateAdEditPlanForBrief } from "../src/lib/services/ad-agent-service";
import { preprocessDeliveryOrderAssets, registerRawAsset } from "../src/lib/services/asset-service";
import { ensureBriefForAngle } from "../src/lib/services/brief-service";
import { generateRoundIterationReport } from "../src/lib/services/iteration-service";
import { recordMetricsSnapshot } from "../src/lib/services/metrics-service";
import { renderAdEditPlan } from "../src/lib/services/ad-render-service";
import { DEMO_SEED_VIDEO_URL } from "../src/lib/data/demo-seed";

loadEnvConfig(process.cwd());

const DEMO_TITLE = "Aivora Ads E2E Demo · Real Footage Pet Store";

async function main() {
  const reset = process.env.RESET_REAL_FOOTAGE_DEMO !== "false";
  if (reset) {
    await db.deliveryOrder.deleteMany({ where: { title: DEMO_TITLE } });
  }

  const order = await db.deliveryOrder.create({
    data: {
      title: DEMO_TITLE,
      status: "SELLING_POINTS_READY",
      productCategory: "local_service",
      targetPlatform: "tiktok",
      targetCountry: "CA_QC",
      targetLanguage: "en",
      targetRegionVariant: "en-CA",
      maxRounds: 3,
      productInput: {
        product_name: "Neighbourhood pet store and grooming service",
        product_url: "https://example.com/aivora-pet-store-demo",
        price_range: "$29-$99",
        target_audience: "Pet owners within 5 km who want a friendly local shop",
        brand_style: "warm, real, UGC, no hard sell",
        target_platforms: ["tiktok", "instagram_reels"],
        footage_notes:
          "Demo assets represent storefront trust, product shelf proof, and pet reaction moments.",
      } as Prisma.InputJsonValue,
    },
  });

  await db.marketResearch.create({
    data: {
      deliveryOrderId: order.id,
      status: "READY",
      summary:
        "[Demo] Local pet store ads should open with a real pet or store moment, then prove trust through shelves, grooming process, and staff warmth.",
      structured: {
        trend: "Local pet businesses perform best when ads feel like real community proof rather than polished commercials.",
        hot_hooks: ["POV + cute pet reaction", "Before/after grooming reveal", "Hidden local gem"],
        pain_points: ["Hard to trust new groomers", "Pet products feel generic", "Need nearby reliable store"],
        footage_strategy: {
          usable_shot_types: ["storefront", "product shelf", "pet reaction"],
          missing_shots: ["owner on-camera testimonial"],
          first_round_directions: ["UGC review", "cute hook", "before-after proof"],
        },
      } as Prisma.InputJsonValue,
    },
  });

  await db.sellingPoint.createMany({
    data: [
      {
        deliveryOrderId: order.id,
        kind: "core",
        rank: 1,
        title: "Real local trust",
        body: "Use real storefront and staff moments to make the business feel nearby and credible.",
      },
      {
        deliveryOrderId: order.id,
        kind: "scene",
        rank: 2,
        title: "Pet reaction hook",
        body: "Open with a cute pet or grooming moment to stop the scroll in the first three seconds.",
      },
      {
        deliveryOrderId: order.id,
        kind: "scene",
        rank: 3,
        title: "Shelf proof",
        body: "Show real shelves and products to prove assortment without over-explaining.",
      },
      {
        deliveryOrderId: order.id,
        kind: "emotional",
        rank: 4,
        title: "Neighbourhood warmth",
        body: "Position the store as the friendly place pets and owners like returning to.",
      },
      {
        deliveryOrderId: order.id,
        kind: "localization",
        rank: 5,
        title: "Nearby CTA",
        body: "Use a low-friction local CTA for saves, visits, and DMs.",
      },
    ],
  });

  await registerDemoAssets(order.id);
  await preprocessDeliveryOrderAssets(order.id, {
    targetShotMs: 4_000,
    minShotMs: 1_200,
    visualSummary: "Real pet store footage: storefront, products, staff warmth, and pet reaction.",
  });

  const round = await db.round.create({
    data: {
      deliveryOrderId: order.id,
      roundIndex: 1,
      status: "ANGLES_READY",
      optimizationSlots: 3,
      explorationSlots: 2,
    },
  });

  const angles = await createDemoAngles(round.id);
  const briefs = [];
  for (const angle of angles) {
    const brief = await ensureBriefForAngle(angle.id);
    await db.script.create({
      data: {
        videoBriefId: brief.id,
        version: 1,
        language: "en-CA",
        fullText:
          "This local pet store is the kind of place your dog actually wants to walk into. Real products, real care, and a team that knows pets by name. Save this before your next grooming run.",
        hook: "This local pet store is the kind of place your dog actually wants to walk into.",
        cta: "Save this before your next grooming run.",
        isCurrent: true,
      },
    });
    briefs.push(brief);
  }

  const plans = [];
  for (const brief of briefs) {
    plans.push(await generateAdEditPlanForBrief(brief.id));
  }

  if (process.env.REAL_FOOTAGE_DEMO_RENDER !== "false") {
    await renderAdEditPlan(plans[0].id);
  }

  for (const [index, brief] of briefs.entries()) {
    const record = await db.publishRecord.create({
      data: {
        videoBriefId: brief.id,
        platform: "tiktok",
        externalPostId: `demo-real-footage-${index + 1}`,
        publishUrl: `https://www.tiktok.com/@aivora_demo/video/${index + 1}`,
        status: "PUBLISHED",
        publishedAt: new Date(),
        operatorNote: "Seeded demo publish record for metrics loop validation.",
      },
    });
    await recordMetricsSnapshot({
      publishRecordId: record.id,
      windowHours: 24,
      metrics: demoMetrics(index),
      source: "demo_seed",
    });
  }

  const iteration = await generateRoundIterationReport(round.id);

  console.log("✅ Real-footage demo seeded");
  console.log("Order:", order.id);
  console.log("Round:", round.id);
  console.log("Plans:", plans.length);
  console.log("Rendered plan:", plans[0].id);
  console.log("Next-round suggestion:", iteration.nextRound);
}

async function registerDemoAssets(deliveryOrderId: string) {
  const assets = [
    {
      name: "storefront-and-aisle-demo.mp4",
      url: DEMO_SEED_VIDEO_URL,
      notes: "Storefront trust and aisle walkthrough. Good for hook and local proof.",
      tags: ["storefront", "local_trust", "hook_candidate"],
    },
    {
      name: "product-shelf-proof-demo.mp4",
      url: DEMO_SEED_VIDEO_URL,
      notes: "Product shelf and retail proof. Good for mid-video credibility.",
      tags: ["product_shelf", "proof", "b_roll"],
    },
    {
      name: "pet-reaction-moment-demo.mp4",
      url: DEMO_SEED_VIDEO_URL,
      notes: "Pet/store reaction moment. Good for CTA, cover, or closing proof.",
      tags: ["pet_reaction", "cta", "cover"],
    },
  ];

  for (const asset of assets) {
    await registerRawAsset({
      deliveryOrderId,
      type: RawAssetType.VIDEO,
      name: asset.name,
      url: asset.url,
      mimeType: "video/mp4",
      durationMs: 31_000,
      width: 1080,
      height: 1920,
      notes: asset.notes,
      tags: asset.tags,
    });
  }
}

async function createDemoAngles(roundId: string) {
  const data = [
    ["Pet reaction hook", "POV: your dog found their new favorite local shop", "Open on the most emotionally engaging pet/store moment, then prove local trust."],
    ["Shelf proof walkthrough", "A pet store that actually has what you need today", "Use product shelf and aisle footage to prove assortment and convenience."],
    ["Grooming trust angle", "Would you trust your groomer after seeing this?", "Frame the store as warm, careful, and repeatable for anxious pet owners."],
    ["Hidden local gem", "The pet store locals do not gatekeep", "Make it feel like a neighbourhood discovery worth saving."],
    ["Save-before-weekend CTA", "Save this before your weekend pet run", "Push saves and store visits with a direct local CTA."],
  ] as const;

  const angles = [];
  for (const [index, item] of data.entries()) {
    angles.push(
      await db.contentAngle.create({
        data: {
          roundId,
          sortOrder: index + 1,
          type: index < 3 ? "OPTIMIZATION" : "EXPLORATION",
          title: item[0],
          hook: item[1],
          narrative: item[2],
          explorationTheme: index >= 3 ? (index === 3 ? "emotional_moment" : "problem_solution") : null,
          localeNotes: {
            target_language: "en-CA",
            on_camera_recommendation: "PRODUCT_ONLY",
            footage_pick: "Use seeded RawAsset shots only: storefront, shelf proof, pet/store reaction.",
            missing_footage: "Owner testimonial would improve the next round.",
          } as Prisma.InputJsonValue,
        },
      }),
    );
  }
  return angles;
}

function demoMetrics(index: number) {
  const base = 1 - index * 0.08;
  return {
    views: Math.round(4200 * base),
    completion_rate: Number((0.42 * base + 0.12).toFixed(2)),
    retention_3s: Number((0.68 * base + 0.08).toFixed(2)),
    shares: Math.round(42 * base),
    saves: Math.round(75 * base),
    likes: Math.round(310 * base),
    comments: Math.round(26 * base),
  };
}

main()
  .catch((err) => {
    console.error("❌ Real-footage demo seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
