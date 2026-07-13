import { BatchJobStatus, VideoJobStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import {
  __test__ as batchServiceTest,
  syncBatchCounts,
} from "../../src/lib/services/batch-service";
import {
  evaluateDispatchBreaker,
  type BreakerDecision,
} from "../../src/lib/services/dispatch-breaker";
import {
  createBatch,
  expect,
  getBatch,
  runKey,
  test,
  tickBatch,
} from "./framework";

async function breakerDecisionFromFixture(
  rows: Array<{ status: VideoJobStatus; errorMessage: string | null }>,
): Promise<BreakerDecision> {
  const model = db.videoJob as unknown as {
    findMany: (...args: unknown[]) => Promise<unknown>;
  };
  const original = model.findMany;
  model.findMany = async () => rows;
  try {
    return await evaluateDispatchBreaker();
  } finally {
    model.findMany = original;
  }
}

test.afterEach(() => {
  delete process.env.DISPATCH_BREAKER_ENABLED;
  delete process.env.DISPATCH_BREAKER_MIN_SAMPLES;
  delete process.env.DISPATCH_BREAKER_UNHEALTHY_RATE;
});

test("J7：无需 cron，UI 可见 watchdog timeout 与 provider stall", async ({
  page,
  evidence,
}, testInfo) => {
  await page.goto("/app/batches/new");
  const batch = await createBatch(page, {
    imageCount: 2,
    requestedCount: 4,
    key: runKey(testInfo, "j6"),
  });
  expect(batch.videoJobs).toHaveLength(4);
  await page.waitForTimeout(20);

  const [stallJob, timeoutJob] = batch.videoJobs;
  await db.videoJob.update({
    where: { id: timeoutJob.id },
    data: {
      status: VideoJobStatus.RUNNING,
      timeoutAt: new Date(Date.now() - 60_000),
      finishedAt: null,
      errorMessage: null,
      userSafeError: null,
    },
  });
  await db.videoJob.update({
    where: { id: stallJob.id },
    data: {
      status: VideoJobStatus.RUNNING,
      timeoutAt: new Date(Date.now() + 60_000),
      finishedAt: null,
      errorMessage: null,
      userSafeError: null,
    },
  });
  await db.batchJob.update({
    where: { id: batch.id },
    data: { status: BatchJobStatus.RUNNING, finishedAt: null },
  });

  await tickBatch(page, batch.id);
  const current = await getBatch(page, batch.id);
  const timeout = current.videoJobs.find((job) => job.id === timeoutJob.id);
  const stalled = current.videoJobs.find((job) => job.id === stallJob.id);
  expect(timeout?.errorMessage).toMatch(/^\[watchdog:timeout]/);
  expect(stalled?.errorMessage).toMatch(/^\[watchdog:provider_stalled]/);

  await page.goto(`/app/batches/${batch.id}`);
  await expect(page.getByText(/视频生成超时，已自动停止/)).toBeVisible();
  await expect(page.getByText(/视频生成服务长时间无响应/)).toBeVisible();
  expect(
    evidence.network.filter((entry) => String(entry.url).includes("/api/cron/")),
    "J6 不得调用 cron",
  ).toEqual([]);
});

test("J6：高失败夹具触发 open/paused/half-open/resume 并清理", async ({
  page,
}, testInfo) => {
  process.env.DISPATCH_BREAKER_ENABLED = "true";
  process.env.DISPATCH_BREAKER_MIN_SAMPLES = "3";
  process.env.DISPATCH_BREAKER_UNHEALTHY_RATE = ".8";

  await page.goto("/app/batches/new");
  const batch = await createBatch(page, {
    imageCount: 2,
    requestedCount: 6,
    key: runKey(testInfo, "j7"),
  });
  await db.videoJob.updateMany({
    where: { batchJobId: batch.id },
    data: {
      status: VideoJobStatus.QUEUED,
      externalJobId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });

  const failedRows = Array.from({ length: 3 }, () => ({
    status: VideoJobStatus.FAILED,
    errorMessage: "[provider:failed] final acceptance injected outage",
  }));
  const open = await breakerDecisionFromFixture([
    ...failedRows,
    { status: VideoJobStatus.RUNNING, errorMessage: null },
  ]);
  expect(open.state).toBe("open");
  expect(open.allowed).toBe(false);
  await batchServiceTest.applyBreaker(batch.id, open);
  await syncBatchCounts(batch.id);

  await page.goto(`/app/batches/${batch.id}`);
  await expect(page.getByText("已暂停", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/生成服务暂时拥堵/)).toBeVisible();

  const halfOpen = await breakerDecisionFromFixture(failedRows);
  expect(halfOpen.state).toBe("half_open_probe");
  expect(halfOpen.allowed).toBe(true);
  await batchServiceTest.applyBreaker(batch.id, halfOpen);
  await syncBatchCounts(batch.id);
  await page.reload();
  await expect(page.getByText("生成中", { exact: true }).first()).toBeVisible();
  const halfState = await getBatch(page, batch.id);
  expect(halfState.statusReason).toContain("半开");

  await batchServiceTest.applyBreaker(batch.id, open);
  await syncBatchCounts(batch.id);
  const closed = await breakerDecisionFromFixture(
    Array.from({ length: 10 }, () => ({
      status: VideoJobStatus.SUCCEEDED,
      errorMessage: null,
    })),
  );
  expect(closed.state).toBe("closed");
  await batchServiceTest.applyBreaker(batch.id, closed);
  await syncBatchCounts(batch.id);
  await page.reload();
  await expect(page.getByText("生成中", { exact: true }).first()).toBeVisible();
  const resumed = await getBatch(page, batch.id);
  expect(resumed.status).toBe("RUNNING");
  expect(resumed.statusReason).toContain("恢复");
});
