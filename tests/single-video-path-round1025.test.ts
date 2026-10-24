import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";

import { db } from "../src/lib/db";
import { loadCreateRetryPrefill } from "../src/lib/services/create-retry-prefill-service";
import {
  dispatchVideoForBrief,
  pollRunningJobs,
  pollRunningJobsOrderBy,
  pollRunningJobsWhere,
} from "../src/lib/services/video-service";

/**
 * 单条创作路径（round 1025 · A2 3.2 / 3.4 / 3.5 / 3.6）。全部 monkey-patch Prisma，零计费。
 */

function patch(
  t: TestContext,
  model: Record<string, unknown>,
  patches: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

test("pollRunningJobs 只轮询单条任务，按最久没查过（从未查过的最先）排序", async (t) => {
  const where = pollRunningJobsWhere();
  assert.equal(where.batchJobId, null, "batch jobs are driven by the batch tick, not this poller");
  assert.deepEqual(where.status, { in: ["QUEUED", "RUNNING"] });
  assert.deepEqual(where.externalJobId, { not: null });
  const orderBy = pollRunningJobsOrderBy();
  assert.deepEqual(orderBy[0], { lastCheckedAt: { sort: "asc", nulls: "first" } });

  const calls: Array<Record<string, unknown>> = [];
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findMany: async (args: Record<string, unknown>) => {
      calls.push(args);
      return [];
    },
  });
  assert.deepEqual(await pollRunningJobs(30), { polled: 0, updated: 0 });
  assert.deepEqual(calls[0].where, where);
  assert.deepEqual(calls[0].orderBy, orderBy);
  assert.equal(calls[0].take, 30);
});

test("单条派发：brief 参考图 = 商家实拍在前 + 已确认故事板帧在后", async (t) => {
  let briefReads = 0;
  const briefUpdates: Array<Record<string, unknown>> = [];
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findUnique: async () => {
      briefReads += 1;
      // 第一次：dispatchVideoForBrief 的路径判断；第二次：分段派发——在这里截断，不碰供应商。
      return briefReads === 1
        ? { id: "brief-1", targetDurationSec: 15, directorPlan: { segmentPlan: [] } }
        : null;
    },
    update: async (args: { data: Record<string, unknown> }) => {
      briefUpdates.push(args.data);
      return {};
    },
  });
  patch(t, db.storyboardRun as unknown as Record<string, unknown>, {
    findUnique: async () => ({
      id: "run-1",
      userId: "owner-1",
      status: "APPROVED",
      durationSec: 15,
      inputImageUrls: ["https://a.test/real-front.jpg", "https://a.test/real-side.jpg"],
      frames: Array.from({ length: 4 }, (_, ordinal) => ({
        id: `f${ordinal}`,
        ordinal,
        status: "SUCCEEDED",
        isCurrent: true,
        outputAsset: { userId: "owner-1", url: `https://a.test/frame-${ordinal}.png` },
      })),
    }),
  });

  await assert.rejects(dispatchVideoForBrief("brief-1"), /Brief 不存在/);
  assert.equal(briefUpdates.length, 1);
  assert.deepEqual(briefUpdates[0].referenceImageUrls, [
    "https://a.test/real-front.jpg",
    "https://a.test/real-side.jpg",
    "https://a.test/frame-0.png",
    "https://a.test/frame-1.png",
    "https://a.test/frame-2.png",
    "https://a.test/frame-3.png",
  ]);
});

function retryOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    productInput: { source: "unified_input", rawPrompt: "  Show the blackout shade at golden hour  " },
    rounds: [
      {
        angles: [
          {
            videoBrief: {
              durationSec: 30,
              targetDurationSec: 30,
              aspectRatio: "16:9",
              storyboardRun: {
                userId: "owner-1",
                sourcePrompt: "storyboard prompt",
                durationSec: 30,
                aspectRatio: "16:9",
                inputAssetIds: ["asset-b", "asset-a", "asset-video", "asset-gone"],
              },
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("?retry= 预填只按属主读原订单：产品照片（按原顺序、仅图片、仍归本人）+ 方向", async (t) => {
  const orderWhere: Array<Record<string, unknown>> = [];
  const assetWhere: Array<Record<string, unknown>> = [];
  let order: Record<string, unknown> | null = retryOrder();
  patch(t, db.deliveryOrder as unknown as Record<string, unknown>, {
    findFirst: async (args: { where: Record<string, unknown> }) => {
      orderWhere.push(args.where);
      return order;
    },
  });
  patch(t, db.mediaAsset as unknown as Record<string, unknown>, {
    findMany: async (args: { where: Record<string, unknown> }) => {
      assetWhere.push(args.where);
      return [
        { id: "asset-a", url: "https://a.test/a.jpg", mimeType: "image/jpeg", width: 10, height: 10 },
        { id: "asset-b", url: "https://a.test/b.png", mimeType: "image/png", width: 20, height: 20 },
        { id: "asset-video", url: "https://a.test/v.mp4", mimeType: "video/mp4", width: null, height: null },
      ];
    },
  });

  const prefill = await loadCreateRetryPrefill("order-1", "owner-1");
  assert.equal(orderWhere[0].id, "order-1");
  assert.equal(orderWhere[0].createdById, "owner-1", "someone else's order is never readable");
  assert.equal(orderWhere[0].productCategory, "unified_input");
  assert.equal(assetWhere[0].userId, "owner-1");
  assert.ok(prefill);
  assert.equal(prefill.orderId, "order-1");
  assert.equal(prefill.prompt, "Show the blackout shade at golden hour");
  assert.equal(prefill.durationSec, 30);
  assert.equal(prefill.aspectRatio, "16:9");
  assert.deepEqual(prefill.productAssets.map((asset) => asset.id), ["asset-b", "asset-a"]);

  order = null;
  assert.equal(await loadCreateRetryPrefill("order-1", "intruder"), null);
  assert.equal(await loadCreateRetryPrefill("   ", "owner-1"), null);
});

test("?retry= 预填：故事板不属于本人时不带素材；历史订单只带方向", async (t) => {
  patch(t, db.deliveryOrder as unknown as Record<string, unknown>, {
    findFirst: async () =>
      retryOrder({
        rounds: [
          {
            angles: [
              {
                videoBrief: {
                  durationSec: 20,
                  targetDurationSec: 20,
                  aspectRatio: "4:5",
                  storyboardRun: {
                    userId: "someone-else",
                    sourcePrompt: "x",
                    durationSec: 20,
                    aspectRatio: "4:5",
                    inputAssetIds: ["asset-a"],
                  },
                },
              },
            ],
          },
        ],
      }),
  });
  let assetQueries = 0;
  patch(t, db.mediaAsset as unknown as Record<string, unknown>, {
    findMany: async () => {
      assetQueries += 1;
      return [];
    },
  });
  const prefill = await loadCreateRetryPrefill("order-1", "owner-1");
  assert.ok(prefill);
  assert.deepEqual(prefill.productAssets, []);
  assert.equal(assetQueries, 0);
  assert.equal(prefill.durationSec, null, "unsupported durations are not forced into the form");
  assert.equal(prefill.aspectRatio, null);
});

test("创作台「取消这一轮」走服务端真取消，再清浏览器里的幂等键", async () => {
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /storyboards\/\$\{encodeURIComponent\(run\.id\)\}\/cancel/);
  assert.match(studio, /async function cancelCurrentRound\(\)/);
  const cancelBody = studio.slice(
    studio.indexOf("async function cancelCurrentRound()"),
    studio.indexOf("const updateAudioCaptionSettings"),
  );
  assert.match(cancelBody, /await cancelStoryboardOnServer\(run\)/);
  assert.match(cancelBody, /if \(!cancelled\) return;/, "a refused cancel keeps the round instead of pretending");
  assert.match(cancelBody, /invalidatePlan\(\)/, "invalidatePlan clears the stored storyboard / dispatch attempt keys");
  assert.match(studio, /persistStoredAttempt\(STORYBOARD_ATTEMPT_STORAGE_KEY, null\)/);
  // 修改创作方向同样是放弃这一轮。
  const editBody = studio.slice(
    studio.indexOf("async function editStoryboardDirection()"),
    studio.indexOf("async function handleGenerate()"),
  );
  assert.match(editBody, /await cancelStoryboardOnServer\(storyboard\)/);
  // 别处取消的 run 不再出现在面板里，也不会被静默恢复。
  assert.match(studio, /next\?\.status === "CANCELLED"/);
  assert.match(studio, /run\.status === "CANCELLED"\) return;/);
});

test("故事板路由：取消入口 auth → zod → service；创建与重做计入用户限流", async () => {
  const [cancelRoute, createRoute, regenerateRoute] = await Promise.all([
    readFile("src/app/api/video-generation/storyboards/[id]/cancel/route.ts", "utf8"),
    readFile("src/app/api/video-generation/storyboards/route.ts", "utf8"),
    readFile("src/app/api/video-generation/storyboards/[id]/frames/[frameId]/regenerate/route.ts", "utf8"),
  ]);
  assert.match(cancelRoute, /export async function POST/);
  assert.match(cancelRoute, /requireAuth\(\)/);
  assert.match(cancelRoute, /safeParse/);
  assert.match(cancelRoute, /cancelStoryboardRun\(parsed\.data\.id, guard\.session\.user\.id\)/);
  assert.match(createRoute, /userInitiated: true/);
  assert.match(regenerateRoute, /userInitiated: true/);
});

test("/app/create 读 ?retry= 并按属主预填；有预填时不做故事板静默恢复", async () => {
  const [page, studio] = await Promise.all([
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8"),
  ]);
  assert.match(page, /retry\?: string/);
  assert.match(page, /loadCreateRetryPrefill\(retry, session\.user\.id\)/);
  assert.match(page, /retryOfOrderId=\{retryPrefill\?\.orderId \?\? null\}/);
  assert.match(studio, /initialProductAssets\.length > 0 \|\| retryOfOrderId/);
});
