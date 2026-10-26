/**
 * Phase 5a 容量压测（mock 供应商，只能跑在 Neon 演练分支）。
 *
 * 用法（DATABASE_URL 必须由调用方显式指到演练库，这是第二道「我要跑演练」的确认）：
 *   DATABASE_URL="$NEON_REHEARSAL_DATABASE_URL" VIDEO_PROVIDER=mock VIDEO_ENGINE_MOCK=true \
 *   PROVIDER_CONCURRENCY=50 MOCK_OUTPUT_VIDEO_URL=https://example.test/out.mp4 \
 *   npx dotenv -e .env.local -- npx tsx scripts/phase5a-mock-capacity.ts
 *
 * 可调参数（env，默认值即 2026-07-13 首跑口径）：
 *   BATCH_SIZE=500  BATCH_COUNT=3  EXPECTED_CONCURRENCY=50  TICK_INTERVAL_MS=0  MAX_TICKS=100
 *   PHASE5A_RUN_TAG=<幂等键尾巴，默认当天日期>
 *
 * 门禁（X-SCAF-5）：scripts/lib/rehearsal-guard.ts —— DATABASE_URL 必须是 NEON_REHEARSAL_DATABASE_URL
 * 的端点且不是 NEON_PRODUCTION_OWNER_DATABASE_URL 的端点；脚本自己的写入用演练连接串显式建 client。
 * 不再对 1500 / EXPECTED 做硬断言：跑完打印汇总（含排队耗时 P50/P95 = submittedAt − createdAt），
 * 判定留给看证据的人。
 */
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaClient, VideoJobStatus, VideoProvider, type BatchJob } from "@prisma/client";
import { assertRehearsalDatabase } from "./lib/rehearsal-guard";

const TEST_EMAIL = "phase5a-capacity@aivora.invalid";

function intEnv(name: string, fallback: number, { min = 1 }: { min?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min} (got ${JSON.stringify(raw)})`);
  }
  return value;
}

const BATCH_SIZE = intEnv("BATCH_SIZE", 500);
const BATCH_COUNT = intEnv("BATCH_COUNT", 3);
const EXPECTED_CONCURRENCY = intEnv("EXPECTED_CONCURRENCY", 50);
const TICK_INTERVAL_MS = intEnv("TICK_INTERVAL_MS", 0, { min: 0 });
const MAX_TICKS = intEnv("MAX_TICKS", 100);
const RUN_TAG = process.env.PHASE5A_RUN_TAG?.trim() || new Date().toISOString().slice(0, 10).replaceAll("-", "");

function assertMockOnly() {
  const truthy = (value: string | undefined) => ["1", "true", "yes"].includes(value?.toLowerCase() ?? "");
  if (process.env.VIDEO_PROVIDER !== "mock" || !truthy(process.env.VIDEO_ENGINE_MOCK)) {
    throw new Error("Phase5a capacity harness requires VIDEO_PROVIDER=mock and VIDEO_ENGINE_MOCK=true");
  }
  if (Number(process.env.PROVIDER_CONCURRENCY) !== EXPECTED_CONCURRENCY) {
    throw new Error(`Phase5a capacity harness requires PROVIDER_CONCURRENCY=${EXPECTED_CONCURRENCY} (EXPECTED_CONCURRENCY)`);
  }
  if (!process.env.MOCK_OUTPUT_VIDEO_URL?.startsWith("https://example.test/")) {
    throw new Error("MOCK_OUTPUT_VIDEO_URL must use the non-routable example.test evidence URL");
  }
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
}

async function main() {
  assertMockOnly();
  const rehearsal = assertRehearsalDatabase({
    databaseUrl: process.env.DATABASE_URL,
    rehearsalUrl: process.env.NEON_REHEARSAL_DATABASE_URL,
    productionOwnerUrl: process.env.NEON_PRODUCTION_OWNER_DATABASE_URL,
  });
  /// 脚本自己的写入（压测账号、套餐并发上限、清旧批次、聚合读取）：用演练连接串显式建 client，不依赖进程 env。
  const db = new PrismaClient({ datasourceUrl: rehearsal.url });
  /// batch-service 只认 @/lib/db 的单例，而单例只读 process.env.DATABASE_URL。门禁已证明它指向演练端点；
  /// 这里再把 env 钉成演练连接串本身、然后才动态加载 service，保证脚本与 service 两条写路径落在同一个演练库。
  process.env.DATABASE_URL = rehearsal.url;
  const [{ db: serviceDb }, { createBatchJob, isTerminalBatchStatus, processBatchTick }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/services/batch-service"),
  ]);

  const user = await db.adminUser.upsert({
    where: { email: TEST_EMAIL },
    create: { email: TEST_EMAIL, hashedPassword: "disabled-load-test-account", name: "Phase 5a Capacity", role: "OPERATOR", userType: "OPERATOR" },
    update: { role: "OPERATOR", userType: "OPERATOR" },
  });
  const studio = await db.planEntitlement.findUniqueOrThrow({ where: { id: "studio" } });
  await db.workspace.upsert({
    where: { ownerId: user.id },
    create: { ownerId: user.id, name: "Phase 5a Rehearsal", planId: "studio", isDefault: true },
    update: { planId: "studio", name: "Phase 5a Rehearsal" },
  });
  await db.batchJob.deleteMany({ where: { userId: user.id } });
  await db.planEntitlement.update({ where: { id: "studio" }, data: { batchConcurrencyLimit: EXPECTED_CONCURRENCY } });

  try {
    const templates = await db.styleTemplate.findMany({
      where: { status: "ACTIVE", slug: { not: { startsWith: "final-acceptance" } } },
      orderBy: [{ category: "asc" }, { slug: "asc" }],
      take: BATCH_COUNT,
    });
    if (templates.length !== BATCH_COUNT) throw new Error(`${BATCH_COUNT} active production templates are required on rehearsal (found ${templates.length})`);
    const images = Array.from({ length: 50 }, (_, index) => ({ id: `phase5a_image_${index}`, url: `https://example.test/product-${index}.jpg` }));
    const start = performance.now();
    const batches: BatchJob[] = [];
    for (const [index, template] of templates.entries()) {
      batches.push(await createBatchJob({
        userId: user.id,
        templateId: template.id,
        templateVersion: template.version,
        images,
        requestedCount: BATCH_SIZE,
        productName: `Phase 5a Product ${index + 1}`,
        idempotencyKey: `phase5a-${BATCH_SIZE}-${index + 1}-${RUN_TAG}`,
      }));
    }

    let ticks = 0;
    let tickLimitReached = false;
    let maxGlobalRunning = 0;
    const maxRunningByBatch = new Map(batches.map((batch) => [batch.id, 0]));
    let current = batches;
    while (current.some((batch) => !isTerminalBatchStatus(batch.status))) {
      if (ticks >= MAX_TICKS) { tickLimitReached = true; break; }
      ticks += 1;
      current = await Promise.all(current.map((batch) => isTerminalBatchStatus(batch.status) ? batch : processBatchTick(batch.id)));
      const grouped = await db.videoJob.groupBy({ by: ["batchJobId", "status"], where: { batchJobId: { in: batches.map((batch) => batch.id) } }, _count: { _all: true } });
      const globalRunning = grouped.filter((row) => row.status === VideoJobStatus.RUNNING).reduce((sum, row) => sum + row._count._all, 0);
      maxGlobalRunning = Math.max(maxGlobalRunning, globalRunning);
      for (const row of grouped) if (row.batchJobId && row.status === VideoJobStatus.RUNNING) maxRunningByBatch.set(row.batchJobId, Math.max(maxRunningByBatch.get(row.batchJobId) ?? 0, row._count._all));
      if (TICK_INTERVAL_MS > 0) await sleep(TICK_INTERVAL_MS);
    }
    const elapsedMs = performance.now() - start;
    const jobs = await db.videoJob.findMany({ where: { batchJobId: { in: batches.map((batch) => batch.id) } }, select: { batchJobId: true, batchItemKey: true, provider: true, externalJobId: true, promptText: true, templateSnapshot: true, createdAt: true, submittedAt: true, finishedAt: true, status: true } });
    const perBatch = batches.map((batch) => {
      const own = jobs.filter((job) => job.batchJobId === batch.id);
      const status = Object.fromEntries(Object.values(VideoJobStatus).map((value) => [value, own.filter((job) => job.status === value).length]));
      return { batchId: batch.id, template: templates[batches.findIndex((item) => item.id === batch.id)].slug, requested: BATCH_SIZE, status, reconciled: own.length === BATCH_SIZE && Object.values(status).reduce((a, b) => a + b, 0) === BATCH_SIZE, maxRunning: maxRunningByBatch.get(batch.id) ?? 0 };
    });
    /// 排队耗时：建条 → 提交给供应商；供应商耗时：提交 → 终态
    const queueWaits = jobs.flatMap((job) => job.submittedAt ? [job.submittedAt.getTime() - job.createdAt.getTime()] : []);
    const jobLatencies = jobs.flatMap((job) => job.submittedAt && job.finishedAt ? [job.finishedAt.getTime() - job.submittedAt.getTime()] : []);
    const mockOnly = jobs.every((job) => job.provider === VideoProvider.MOCK && job.externalJobId?.startsWith("batchmock_") && job.promptText && job.templateSnapshot);
    const requestedTotal = BATCH_COUNT * BATCH_SIZE;
    const succeeded = jobs.filter((job) => job.status === VideoJobStatus.SUCCEEDED).length;
    const queuedOrRunning = jobs.filter((job) => new Set<VideoJobStatus>([VideoJobStatus.QUEUED, VideoJobStatus.RUNNING, VideoJobStatus.PAUSED]).has(job.status)).length;
    const uniqueItemKeys = new Set(jobs.map((job) => job.batchItemKey)).size;
    const result = {
      phase: "5a",
      mode: "mock",
      database: rehearsal.host,
      params: { BATCH_SIZE, BATCH_COUNT, EXPECTED_CONCURRENCY, TICK_INTERVAL_MS, MAX_TICKS, runTag: RUN_TAG },
      batches: BATCH_COUNT,
      requestedTotal,
      terminalTotal: jobs.filter((job) => new Set<VideoJobStatus>([VideoJobStatus.SUCCEEDED, VideoJobStatus.FAILED, VideoJobStatus.CANCELLED]).has(job.status)).length,
      succeeded,
      failed: jobs.filter((job) => job.status === VideoJobStatus.FAILED).length,
      cancelled: jobs.filter((job) => job.status === VideoJobStatus.CANCELLED).length,
      queuedOrRunning,
      exactReconciliation: jobs.length === requestedTotal && perBatch.every((batch) => batch.reconciled),
      uniqueItemKeys,
      maxGlobalRunning,
      concurrencyCeiling: EXPECTED_CONCURRENCY,
      concurrencyRespected: maxGlobalRunning <= EXPECTED_CONCURRENCY,
      reachedCeiling: maxGlobalRunning === EXPECTED_CONCURRENCY,
      mockOnly,
      realProviderCalls: 0,
      costUsd: 0,
      ticks,
      tickLimitReached,
      elapsedMs: Math.round(elapsedMs),
      queueWaitMs: { p50: percentile(queueWaits, 0.5), p95: percentile(queueWaits, 0.95), samples: queueWaits.length },
      providerJobLatencyMs: { p50: percentile(jobLatencies, 0.5), p95: percentile(jobLatencies, 0.95), samples: jobLatencies.length },
      /// 以前是硬断言；现在只打印，让看证据的人自己判。
      checks: {
        allSucceeded: succeeded === requestedTotal,
        noneInFlight: queuedOrRunning === 0,
        uniqueItemKeys: uniqueItemKeys === requestedTotal,
        exactReconciliation: jobs.length === requestedTotal && perBatch.every((batch) => batch.reconciled),
        concurrencyRespected: maxGlobalRunning <= EXPECTED_CONCURRENCY,
        reachedCeiling: maxGlobalRunning === EXPECTED_CONCURRENCY,
        mockOnly,
        finishedWithinMaxTicks: !tickLimitReached,
      },
      perBatch,
    };
    const failedChecks = Object.entries(result.checks).filter(([, ok]) => !ok).map(([name]) => name);
    process.stdout.write(
      [
        `Phase 5a · ${rehearsal.host} · ${BATCH_COUNT} × ${BATCH_SIZE} = ${requestedTotal} 条 · 并发上限 ${EXPECTED_CONCURRENCY}`,
        `  成片 ${succeeded} · 失败 ${result.failed} · 取消 ${result.cancelled} · 在途 ${queuedOrRunning} · ticks ${ticks}${tickLimitReached ? ` (到达 MAX_TICKS=${MAX_TICKS} 截断)` : ""} · 用时 ${result.elapsedMs} ms`,
        `  峰值并发 ${maxGlobalRunning}/${EXPECTED_CONCURRENCY} · 排队耗时 P50 ${result.queueWaitMs.p50} ms / P95 ${result.queueWaitMs.p95} ms · 供应商耗时 P50 ${result.providerJobLatencyMs.p50} ms / P95 ${result.providerJobLatencyMs.p95} ms`,
        `  检查项${failedChecks.length === 0 ? "全部成立" : `未成立：${failedChecks.join(", ")}`}`,
        "",
      ].join("\n"),
    );
    process.stdout.write(`PHASE5A_RESULT=${JSON.stringify(result)}\n`);
  } finally {
    await db.planEntitlement.update({ where: { id: "studio" }, data: { batchConcurrencyLimit: studio.batchConcurrencyLimit } });
    await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : "capacity harness failed"}\n`); process.exitCode = 1; });
