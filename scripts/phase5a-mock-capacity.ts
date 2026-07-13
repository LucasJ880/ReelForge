import { performance } from "node:perf_hooks";
import { VideoJobStatus, VideoProvider, type BatchJob } from "@prisma/client";
import { db } from "@/lib/db";
import { createBatchJob, isTerminalBatchStatus, processBatchTick } from "@/lib/services/batch-service";

const TEST_EMAIL = "phase5a-capacity@aivora.invalid";
const BATCH_SIZE = 500;
const BATCH_COUNT = 3;
const EXPECTED_CONCURRENCY = 50;

function assertMockOnly() {
  const truthy = (value: string | undefined) => ["1", "true", "yes"].includes(value?.toLowerCase() ?? "");
  if (process.env.VIDEO_PROVIDER !== "mock" || !truthy(process.env.VIDEO_ENGINE_MOCK)) {
    throw new Error("Phase5a capacity harness requires VIDEO_PROVIDER=mock and VIDEO_ENGINE_MOCK=true");
  }
  if (Number(process.env.PROVIDER_CONCURRENCY) !== EXPECTED_CONCURRENCY) {
    throw new Error(`Phase5a capacity harness requires PROVIDER_CONCURRENCY=${EXPECTED_CONCURRENCY}`);
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
  const dbHost = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!dbHost.includes("us-east-1.aws.neon.tech")) throw new Error("Capacity harness requires the Neon rehearsal branch");

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
    if (templates.length !== BATCH_COUNT) throw new Error("Three active production templates are required on rehearsal");
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
        idempotencyKey: `phase5a-500-${index + 1}-20260713`,
      }));
    }

    let ticks = 0;
    let maxGlobalRunning = 0;
    const maxRunningByBatch = new Map(batches.map((batch) => [batch.id, 0]));
    let current = batches;
    while (current.some((batch) => !isTerminalBatchStatus(batch.status))) {
      if (ticks++ > 100) throw new Error("Capacity harness exceeded 100 ticks");
      current = await Promise.all(current.map((batch) => isTerminalBatchStatus(batch.status) ? batch : processBatchTick(batch.id)));
      const grouped = await db.videoJob.groupBy({ by: ["batchJobId", "status"], where: { batchJobId: { in: batches.map((batch) => batch.id) } }, _count: { _all: true } });
      const globalRunning = grouped.filter((row) => row.status === VideoJobStatus.RUNNING).reduce((sum, row) => sum + row._count._all, 0);
      maxGlobalRunning = Math.max(maxGlobalRunning, globalRunning);
      for (const row of grouped) if (row.batchJobId && row.status === VideoJobStatus.RUNNING) maxRunningByBatch.set(row.batchJobId, Math.max(maxRunningByBatch.get(row.batchJobId) ?? 0, row._count._all));
    }
    const elapsedMs = performance.now() - start;
    const jobs = await db.videoJob.findMany({ where: { batchJobId: { in: batches.map((batch) => batch.id) } }, select: { batchJobId: true, batchItemKey: true, provider: true, externalJobId: true, promptText: true, templateSnapshot: true, submittedAt: true, finishedAt: true, status: true } });
    const perBatch = batches.map((batch) => {
      const own = jobs.filter((job) => job.batchJobId === batch.id);
      const status = Object.fromEntries(Object.values(VideoJobStatus).map((value) => [value, own.filter((job) => job.status === value).length]));
      return { batchId: batch.id, template: templates[batches.findIndex((item) => item.id === batch.id)].slug, requested: BATCH_SIZE, status, reconciled: own.length === BATCH_SIZE && Object.values(status).reduce((a, b) => a + b, 0) === BATCH_SIZE, maxRunning: maxRunningByBatch.get(batch.id) ?? 0 };
    });
    const jobLatencies = jobs.flatMap((job) => job.submittedAt && job.finishedAt ? [job.finishedAt.getTime() - job.submittedAt.getTime()] : []);
    const mockOnly = jobs.every((job) => job.provider === VideoProvider.MOCK && job.externalJobId?.startsWith("batchmock_") && job.promptText && job.templateSnapshot);
    const result = {
      phase: "5a",
      mode: "mock",
      database: "neon-rehearsal-us-east-1",
      batches: BATCH_COUNT,
      requestedTotal: BATCH_COUNT * BATCH_SIZE,
      terminalTotal: jobs.filter((job) => new Set<VideoJobStatus>([VideoJobStatus.SUCCEEDED, VideoJobStatus.FAILED, VideoJobStatus.CANCELLED]).has(job.status)).length,
      succeeded: jobs.filter((job) => job.status === VideoJobStatus.SUCCEEDED).length,
      failed: jobs.filter((job) => job.status === VideoJobStatus.FAILED).length,
      cancelled: jobs.filter((job) => job.status === VideoJobStatus.CANCELLED).length,
      queuedOrRunning: jobs.filter((job) => new Set<VideoJobStatus>([VideoJobStatus.QUEUED, VideoJobStatus.RUNNING, VideoJobStatus.PAUSED]).has(job.status)).length,
      exactReconciliation: jobs.length === BATCH_COUNT * BATCH_SIZE && perBatch.every((batch) => batch.reconciled),
      uniqueItemKeys: new Set(jobs.map((job) => job.batchItemKey)).size,
      maxGlobalRunning,
      concurrencyCeiling: EXPECTED_CONCURRENCY,
      concurrencyRespected: maxGlobalRunning <= EXPECTED_CONCURRENCY,
      mockOnly,
      realProviderCalls: 0,
      costUsd: 0,
      ticks,
      elapsedMs: Math.round(elapsedMs),
      providerJobLatencyMs: { p50: percentile(jobLatencies, 0.5), p95: percentile(jobLatencies, 0.95) },
      perBatch,
    };
    if (!result.exactReconciliation || !result.concurrencyRespected || !result.mockOnly || result.succeeded !== 1500 || result.queuedOrRunning !== 0 || result.uniqueItemKeys !== 1500 || maxGlobalRunning !== EXPECTED_CONCURRENCY) throw new Error(`Capacity acceptance failed: ${JSON.stringify(result)}`);
    process.stdout.write(`PHASE5A_RESULT=${JSON.stringify(result)}\n`);
  } finally {
    await db.planEntitlement.update({ where: { id: "studio" }, data: { batchConcurrencyLimit: studio.batchConcurrencyLimit } });
    await db.$disconnect();
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : "capacity harness failed"}\n`); process.exitCode = 1; });
