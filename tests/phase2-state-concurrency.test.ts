import assert from "node:assert/strict";
import test from "node:test";
import {
  BatchJobStatus,
  FinalVideoStatus,
  VideoJobStatus,
} from "@prisma/client";
import {
  __test__ as batchTest,
  deriveBatchStatus,
  isTerminalBatchStatus,
} from "../src/lib/services/batch-service";

test("Phase 2 state audit: every VideoJob status has an explicit batch aggregation outcome", () => {
  const singleJobOutcome = {
    [VideoJobStatus.QUEUED]: BatchJobStatus.RUNNING,
    [VideoJobStatus.PAUSED]: BatchJobStatus.PAUSED,
    [VideoJobStatus.RUNNING]: BatchJobStatus.RUNNING,
    [VideoJobStatus.SUCCEEDED]: BatchJobStatus.COMPLETED,
    [VideoJobStatus.FAILED]: BatchJobStatus.FAILED,
    [VideoJobStatus.CANCELLED]: BatchJobStatus.CANCELLED,
  } satisfies Record<VideoJobStatus, BatchJobStatus>;

  assert.deepEqual(
    Object.keys(singleJobOutcome).sort(),
    Object.values(VideoJobStatus).sort(),
    "新增 VideoJob 状态时必须先定义批次聚合语义",
  );
  for (const status of Object.values(VideoJobStatus)) {
    assert.equal(
      deriveBatchStatus({ requestedCount: 1, counts: { [status]: 1 } }),
      singleJobOutcome[status],
      `VideoJob.${status} 的聚合结果错误`,
    );
  }
});

test("Phase 2 state audit: mixed child states preserve active, paused, and terminal precedence", () => {
  const cases: Array<{
    name: string;
    requestedCount: number;
    counts: Partial<Record<VideoJobStatus, number>>;
    expected: BatchJobStatus;
  }> = [
    {
      name: "queued sibling keeps batch active",
      requestedCount: 3,
      counts: { SUCCEEDED: 1, FAILED: 1, QUEUED: 1 },
      expected: BatchJobStatus.RUNNING,
    },
    {
      name: "running sibling keeps batch active",
      requestedCount: 3,
      counts: { SUCCEEDED: 1, CANCELLED: 1, RUNNING: 1 },
      expected: BatchJobStatus.RUNNING,
    },
    {
      name: "paused child preserves operator pause",
      requestedCount: 3,
      counts: { SUCCEEDED: 1, RUNNING: 1, PAUSED: 1 },
      expected: BatchJobStatus.PAUSED,
    },
    {
      name: "success plus failure is partial",
      requestedCount: 3,
      counts: { SUCCEEDED: 2, FAILED: 1 },
      expected: BatchJobStatus.PARTIAL_FAILED,
    },
    {
      name: "success plus cancellation is partial",
      requestedCount: 3,
      counts: { SUCCEEDED: 2, CANCELLED: 1 },
      expected: BatchJobStatus.PARTIAL_FAILED,
    },
    {
      name: "failure plus cancellation without success is failed",
      requestedCount: 3,
      counts: { FAILED: 2, CANCELLED: 1 },
      expected: BatchJobStatus.FAILED,
    },
    {
      name: "all succeeded is complete",
      requestedCount: 3,
      counts: { SUCCEEDED: 3 },
      expected: BatchJobStatus.COMPLETED,
    },
    {
      name: "all cancelled is cancelled",
      requestedCount: 3,
      counts: { CANCELLED: 3 },
      expected: BatchJobStatus.CANCELLED,
    },
  ];

  for (const scenario of cases) {
    const accounted = Object.values(scenario.counts).reduce(
      (total, count) => total + (count ?? 0),
      0,
    );
    assert.equal(accounted, scenario.requestedCount, scenario.name);
    assert.equal(
      deriveBatchStatus(scenario),
      scenario.expected,
      scenario.name,
    );
  }
});

test("Phase 2 state audit: BatchJob and FinalVideo terminal semantics are exhaustive", () => {
  const batchTerminal = Object.fromEntries(
    Object.values(BatchJobStatus).map((status) => [
      status,
      isTerminalBatchStatus(status),
    ]),
  ) as Record<BatchJobStatus, boolean>;
  assert.deepEqual(batchTerminal, {
    EXPANDING: false,
    RUNNING: false,
    PAUSED: false,
    COMPLETED: true,
    PARTIAL_FAILED: true,
    FAILED: true,
    CANCELLED: true,
  } satisfies Record<BatchJobStatus, boolean>);

  const finalVideoTerminal = {
    [FinalVideoStatus.PENDING]: false,
    [FinalVideoStatus.STITCHING]: false,
    [FinalVideoStatus.READY]: true,
    [FinalVideoStatus.FAILED]: true,
  } satisfies Record<FinalVideoStatus, boolean>;
  assert.deepEqual(
    Object.keys(finalVideoTerminal).sort(),
    Object.values(FinalVideoStatus).sort(),
    "新增 FinalVideo 状态时必须先定义终态语义",
  );
});

test("Phase 2 concurrency: 50 mock tasks settle once, respect the cap, and isolate sibling failures", async () => {
  const taskIds = Array.from({ length: 50 }, (_, index) => index);
  const failureIds = new Set([0, 11, 37]);
  const cancellationIds = new Set([7, 19, 31]);
  const attempts = new Map<number, number>();
  const terminal = new Map<number, VideoJobStatus>();
  let inFlight = 0;
  let peak = 0;
  let caught: unknown;

  try {
    await batchTest.mapConcurrent(taskIds, 8, async (taskId) => {
      attempts.set(taskId, (attempts.get(taskId) ?? 0) + 1);
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        // Model an asynchronous mock-provider boundary without spending budget.
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (failureIds.has(taskId)) {
          terminal.set(taskId, VideoJobStatus.FAILED);
          throw new Error(`injected provider failure for ${taskId}`);
        }
        terminal.set(
          taskId,
          cancellationIds.has(taskId)
            ? VideoJobStatus.CANCELLED
            : VideoJobStatus.SUCCEEDED,
        );
      } finally {
        inFlight--;
      }
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof AggregateError, "item failures remain observable");
  assert.equal(caught.errors.length, failureIds.size);
  assert.ok(peak > 1, "the harness exercised real parallel work");
  assert.ok(peak <= 8, `peak concurrency ${peak} exceeded the configured cap`);
  assert.equal(inFlight, 0, "no worker may remain in flight after settlement");
  assert.equal(attempts.size, 50, "no task may be lost after a sibling fails");
  assert.equal(terminal.size, 50, "all submitted tasks must reach a terminal state");
  assert.equal(attempts.get(49), 1, "late siblings still execute after early failures");
  for (const [taskId, count] of attempts) {
    assert.equal(count, 1, `task ${taskId} was submitted more than once`);
  }

  const counts = {
    success: [...terminal.values()].filter(
      (status) => status === VideoJobStatus.SUCCEEDED,
    ).length,
    failed: [...terminal.values()].filter(
      (status) => status === VideoJobStatus.FAILED,
    ).length,
    cancelled: [...terminal.values()].filter(
      (status) => status === VideoJobStatus.CANCELLED,
    ).length,
  };
  assert.deepEqual(counts, { success: 44, failed: 3, cancelled: 3 });
  assert.equal(
    taskIds.length,
    counts.success + counts.failed + counts.cancelled,
    "submitted must equal success + failed + cancelled",
  );
  assert.equal(
    deriveBatchStatus({
      requestedCount: taskIds.length,
      counts: {
        SUCCEEDED: counts.success,
        FAILED: counts.failed,
        CANCELLED: counts.cancelled,
      },
    }),
    BatchJobStatus.PARTIAL_FAILED,
  );
});
