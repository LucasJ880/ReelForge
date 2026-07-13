/**
 * MOCK 批量管线自动化验收（会写临时数据并在 finally 删除）：
 * - 20 图 × 100：93 成功 / 5 provider failure / 2 provider_stalled
 * - 幂等连发 3 次仍只有 100 个 VideoJob
 * - retry failed 后 100/100 COMPLETED，分配与模板快照不变
 * - N=200：DB 中同一 Mock provider RUNNING 峰值不超过并发配置
 */
import assert from "node:assert/strict";
import {
  BatchJobStatus,
  StyleTemplateStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "../src/lib/db";
import { __resetAppEnvForTests } from "../src/lib/config/env";
import {
  createBatchJob,
  getBatchStatus,
  isTerminalBatchStatus,
  processBatchTick,
  retryFailedBatchJobs,
} from "../src/lib/services/batch-service";
import { countAssetUsage } from "../src/lib/video-generation/asset-allocator";

const RUN_ID = `batch-e2e-${Date.now()}`;
const createdBatchIds: string[] = [];
let templateId: string | null = null;

async function drive(batchId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let peakRunning = 0;
  while (Date.now() < deadline) {
    const batch = await processBatchTick(batchId);
    const running = await db.videoJob.count({
      where: { batchJobId: batchId, status: VideoJobStatus.RUNNING },
    });
    peakRunning = Math.max(peakRunning, running);
    if (isTerminalBatchStatus(batch.status)) return { batch, peakRunning };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Batch ${batchId} 未在 ${timeoutMs}ms 内到达终态`);
}

async function main() {
  Object.assign(process.env, {
    VIDEO_PROVIDER: "mock",
    PROVIDER_CONCURRENCY: "10",
    MOCK_LATENCY_MS: "20",
    MOCK_LATENCY_JITTER: "0",
    MOCK_FAILURE_RATE: "0.05",
    MOCK_STALL_RATE: "0.02",
    PROVIDER_STALL_MIN: "0.0001",
    WATCHDOG_GRACE_MIN: "0",
    DISPATCH_BREAKER_ENABLED: "false",
    MOCK_OUTPUT_VIDEO_URL:
      "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  });
  __resetAppEnvForTests();

  const user = await db.adminUser.findFirst({ orderBy: { createdAt: "asc" } });
  assert.ok(user, "数据库至少需要一个测试用户");
  const template = await db.styleTemplate.create({
    data: {
      slug: RUN_ID,
      version: 1,
      name: "Batch E2E Single Image",
      nameZh: "批量 E2E 单图模板",
      category: "test",
      coverImage: "https://picsum.photos/seed/aivora-cover/640/960",
      promptSkeleton:
        "Use {IMAGE_REFS} as the exact product. Product {PRODUCT_NAME}. Slow camera push-in, softbox lighting, brisk three-beat pacing.",
      negativePrompt:
        "label blur, product morphing, sole deformation, extra fingers, text overlay",
      lockedParams: {
        duration: 10,
        aspectRatio: "9:16",
        resolution: "1080p",
        cameraStyle: "slow push-in",
      },
      imagesPerVideo: { min: 1, max: 1 },
      status: StyleTemplateStatus.ACTIVE,
      activatedAt: new Date(),
    },
  });
  templateId = template.id;
  const images = Array.from({ length: 20 }, (_, index) => ({
    id: `${RUN_ID}-image-${index}`,
    url: `https://picsum.photos/seed/${RUN_ID}-${index}/720/1280`,
  }));
  const input = {
    userId: user.id,
    templateId: template.id,
    templateVersion: 1,
    images,
    requestedCount: 100,
    productName: "Aivora Test Product",
    idempotencyKey: `${RUN_ID}-100`,
  };

  const first = await createBatchJob(input);
  createdBatchIds.push(first.id);
  const second = await createBatchJob(input);
  const third = await createBatchJob(input);
  assert.equal(first.id, second.id);
  assert.equal(second.id, third.id);
  assert.equal(
    await db.videoJob.count({ where: { batchJobId: first.id } }),
    100,
    "三次幂等请求只能展开 100 条",
  );

  const baseline = await drive(first.id);
  assert.equal(baseline.batch.status, BatchJobStatus.PARTIAL_FAILED);
  assert.equal(baseline.batch.completedCount, 93);
  assert.equal(baseline.batch.failedCount, 7);
  assert.ok(baseline.peakRunning <= 10);

  const baselineStatus = await getBatchStatus(first.id, user.id);
  const usage = countAssetUsage(
    baselineStatus.videoJobs.map(
      (job) =>
        job.assignedAssets as unknown as Parameters<
          typeof countAssetUsage
        >[0][number],
    ),
  );
  for (const image of images) assert.equal(usage.get(image.id), 5);
  for (const failed of baselineStatus.videoJobs.filter(
    (job) => job.status === VideoJobStatus.FAILED,
  )) {
    assert.ok(failed.errorMessage, `失败 job ${failed.id} 必须有 reason`);
  }
  const assignmentSnapshots = new Map(
    baselineStatus.videoJobs.map((job) => [
      job.id,
      JSON.stringify(job.assignedAssets),
    ]),
  );

  process.env.MOCK_FAILURE_RATE = "0";
  process.env.MOCK_STALL_RATE = "0";
  assert.equal(await retryFailedBatchJobs(first.id), 7);
  const retried = await drive(first.id);
  assert.equal(retried.batch.status, BatchJobStatus.COMPLETED);
  assert.equal(retried.batch.completedCount, 100);
  const afterRetry = await getBatchStatus(first.id, user.id);
  for (const job of afterRetry.videoJobs) {
    assert.equal(
      JSON.stringify(job.assignedAssets),
      assignmentSnapshots.get(job.id),
      "retry 必须复用原分配",
    );
  }

  const pressure = await createBatchJob({
    ...input,
    requestedCount: 200,
    idempotencyKey: `${RUN_ID}-200`,
  });
  createdBatchIds.push(pressure.id);
  const startedAt = Date.now();
  const pressureResult = await drive(pressure.id);
  const elapsed = Date.now() - startedAt;
  assert.equal(pressureResult.batch.status, BatchJobStatus.COMPLETED);
  assert.ok(
    pressureResult.peakRunning <= 10,
    `peakRunning=${pressureResult.peakRunning} 超过配置 10`,
  );
  assert.ok(
    pressureResult.peakRunning > 1,
    "必须观察到真实并行，而非串行提交",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseline: {
          batchId: first.id,
          completedBeforeRetry: 93,
          failedBeforeRetry: 7,
          completedAfterRetry: retried.batch.completedCount,
          peakRunning: baseline.peakRunning,
        },
        pressure: {
          batchId: pressure.id,
          requested: 200,
          completed: pressureResult.batch.completedCount,
          peakRunning: pressureResult.peakRunning,
          elapsedMs: elapsed,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const id of createdBatchIds) {
      await db.batchJob.delete({ where: { id } }).catch(() => undefined);
    }
    if (templateId) {
      await db.styleTemplate
        .delete({ where: { id: templateId } })
        .catch(() => undefined);
    }
    await db.$disconnect();
  });
