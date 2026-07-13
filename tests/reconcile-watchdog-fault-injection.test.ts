import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VideoJobStatus, VideoProvider } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  reconcileVideoJob,
  __test__ as videoSvcTest,
} from "../src/lib/services/video-service";
import {
  WATCHDOG_STALLED_PREFIX,
  WATCHDOG_TIMEOUT_PREFIX,
} from "../src/lib/services/video-watchdog";
import type { SeedanceJobResult } from "../src/lib/providers/seedance";

/**
 * AC-1 / AC-3 / AC-6 —— reconcileVideoJob 故障注入测试。
 *
 * 四种故障场景 + provider 僵死，全部断言任务在 deadline 内到达终态，
 * 不存在永久 RUNNING（INV-1）。Prisma 全部 monkey-patch 内存实现，
 * Provider 状态查询通过 __setStatusFetcherForTests 注入，零真实调用、零计费。
 */

process.env.FRAME_QA_DISABLED = "true";

const NOW_MS = Date.now();
const MIN = 60_000;

type JobRow = {
  id: string;
  videoBriefId: string;
  externalJobId: string | null;
  status: VideoJobStatus;
  provider: VideoProvider;
  pollErrors: number;
  retryCount: number;
  timeoutAt: Date | null;
  submittedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastCheckedAt: Date | null;
  lastProviderStatus: string | null;
  errorMessage: string | null;
  userSafeError: string | null;
  outputVideoUrl: string | null;
  outputThumbUrl: string | null;
  finalVideoId: string | null;
  createdAt: Date;
};

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job_test",
    videoBriefId: "brief_test",
    externalJobId: "ext_test",
    status: VideoJobStatus.RUNNING,
    provider: VideoProvider.SEEDANCE_T2V,
    pollErrors: 0,
    retryCount: 0,
    /// 默认：还没到 deadline
    timeoutAt: new Date(NOW_MS + 10 * MIN),
    submittedAt: new Date(NOW_MS - 1 * MIN),
    startedAt: new Date(NOW_MS - 1 * MIN),
    finishedAt: null,
    lastCheckedAt: null,
    lastProviderStatus: "running",
    errorMessage: null,
    userSafeError: null,
    outputVideoUrl: null,
    outputThumbUrl: null,
    finalVideoId: null,
    createdAt: new Date(NOW_MS - 1 * MIN),
    ...overrides,
  };
}

/// 内存版 db.videoJob：findUnique / update / updateMany 语义与 Prisma 对齐（含 CAS）
function installInMemoryJob(t: TestContext, job: JobRow) {
  const model = db.videoJob as unknown as Record<string, unknown>;
  const originals = {
    findUnique: model.findUnique,
    update: model.update,
    updateMany: model.updateMany,
  };
  model.findUnique = async () => ({ ...job });
  model.update = async (args: { data: Partial<JobRow> }) => {
    Object.assign(job, args.data);
    return { ...job };
  };
  model.updateMany = async (args: {
    where: { status?: { in?: VideoJobStatus[] } };
    data: Partial<JobRow>;
  }) => {
    const allowed = args.where.status?.in;
    if (allowed && !allowed.includes(job.status)) return { count: 0 };
    Object.assign(job, args.data);
    return { count: 1 };
  };
  t.after(() => {
    model.findUnique = originals.findUnique;
    model.update = originals.update;
    model.updateMany = originals.updateMany;
  });
  return job;
}

function injectFetcher(
  t: TestContext,
  fn: (jobId: string) => Promise<SeedanceJobResult>,
) {
  videoSvcTest.__setStatusFetcherForTests(
    fn as unknown as Parameters<
      typeof videoSvcTest.__setStatusFetcherForTests
    >[0],
  );
  t.after(() => videoSvcTest.__setStatusFetcherForTests(null));
}

/// 捕获结构化状态迁移日志（AC-5 断言用）
function captureTransitionLogs(t: TestContext): Array<Record<string, unknown>> {
  const logs: Array<Record<string, unknown>> = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.includes("video_job_status_transition")) {
      try {
        logs.push(JSON.parse(first));
        return;
      } catch {
        /* fallthrough */
      }
    }
    original(...args);
  };
  t.after(() => {
    console.log = original;
  });
  return logs;
}

/// ---------- AC-1a：轮询/worker 异常不被吞，达到阈值 → 终态 ----------

test("AC-1a 故障注入：Provider 查询连续抛异常 → pollErrors 递增，阈值内到达 FAILED 终态", async (t) => {
  const job = installInMemoryJob(t, makeJob());
  const logs = captureTransitionLogs(t);
  injectFetcher(t, async () => {
    throw new Error("injected worker exception");
  });

  /// 默认阈值 3：前两次仍非终态但异常被记录（不吞），第三次 FAILED
  await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.RUNNING);
  assert.ok(
    job.errorMessage?.includes("injected worker exception"),
    "异常必须写回任务（禁止吞异常）",
  );
  await reconcileVideoJob(job.id);
  await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.FAILED, "阈值后必须终态化");
  assert.ok(job.userSafeError, "必须有用户可见错误");
  assert.ok(job.finishedAt, "终态必须写 finishedAt");
  assert.ok(
    logs.some((l) => l.to === "FAILED" && String(l.reason).includes("poll_errors_exceeded")),
    "必须记录结构化状态迁移日志",
  );
});

/// ---------- AC-1b：外部 API 超时（请求悬挂被显式超时切断） ----------

test("AC-1b 故障注入：外部 API 超时错误 → 同样走有界重试，不无限悬挂", async (t) => {
  const job = installInMemoryJob(t, makeJob());
  injectFetcher(t, async () => {
    throw new Error("Seedance 查询 timeout: 超过 30000ms 未响应");
  });

  for (let i = 0; i < 3; i++) await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.FAILED);
  assert.ok(job.errorMessage?.includes("timeout"));
});

/// ---------- AC-1c：无回调通道，仅靠轮询也能到终态 ----------

test("AC-1c 故障注入：回调永不到达（通道已删）→ 单靠轮询把任务带到 SUCCEEDED", async (t) => {
  const job = installInMemoryJob(t, makeJob());
  injectFetcher(t, async () => ({
    jobId: "ext_test",
    status: "completed",
    rawProviderStatus: "succeeded",
    videoUrl: "https://example.com/out.mp4",
  }));

  await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.SUCCEEDED);
  assert.equal(job.outputVideoUrl, "https://example.com/out.mp4");
});

/// ---------- AC-1d / AC-3：worker 中途被 kill / provider 失联，硬超时兜底 ----------

test("AC-1d/AC-3 故障注入：任务超过 deadline 且 Provider 完全失联 → 信号 A 直接 FAILED（不调 Provider）", async (t) => {
  const job = installInMemoryJob(
    t,
    /// timeoutAt 已过期 5 分钟（> 默认 2 分钟宽限）—— 等价于 worker 中途被 kill 后无人认领
    makeJob({ timeoutAt: new Date(NOW_MS - 5 * MIN) }),
  );
  const logs = captureTransitionLogs(t);
  let fetcherCalled = 0;
  injectFetcher(t, async () => {
    fetcherCalled++;
    /// 模拟 provider 悬挂：即使被调用也永不返回有效结果
    throw new Error("provider unreachable");
  });

  await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.FAILED, "硬超时必须终态化");
  assert.equal(fetcherCalled, 0, "信号 A 必须在调 Provider 之前判定（悬挂免疫）");
  assert.ok(job.errorMessage?.startsWith(WATCHDOG_TIMEOUT_PREFIX));
  assert.ok(
    logs.some((l) => l.reason === "timeout" && l.to === "FAILED"),
    "必须记录 reason=timeout 的结构化迁移日志",
  );
});

test("AC-3 混沌：一次 reconcile 中途崩溃 → 任务不悬空，下一次 reconcile 收敛到终态", async (t) => {
  const job = installInMemoryJob(
    t,
    makeJob({ timeoutAt: new Date(NOW_MS - 5 * MIN) }),
  );
  const model = db.videoJob as unknown as Record<string, unknown>;
  const goodUpdateMany = model.updateMany;
  /// 第一次 reconcile：写终态时进程被 kill（抛错模拟）
  let crashes = 1;
  model.updateMany = async (...args: unknown[]) => {
    if (crashes > 0) {
      crashes--;
      throw new Error("simulated process kill");
    }
    return (goodUpdateMany as (...a: unknown[]) => Promise<unknown>)(...args);
  };
  injectFetcher(t, async () => {
    throw new Error("should not reach provider");
  });

  await assert.rejects(() => reconcileVideoJob(job.id));
  assert.equal(job.status, VideoJobStatus.RUNNING, "崩溃后任务保持原状（无半写状态）");

  /// 任何后续触发方（前端轮询 / cron / 重试前检查）再跑一次即可收敛
  await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.FAILED);
  assert.ok(job.errorMessage?.startsWith(WATCHDOG_TIMEOUT_PREFIX));
});

/// ---------- AC-6：provider 僵死（永远 running 且 updated_at 不变） ----------

test("AC-6 故障注入：provider 永远 running 且 updated_at 不变 → N 分钟内判 provider_stalled 终态", async (t) => {
  const job = installInMemoryJob(t, makeJob());
  const logs = captureTransitionLogs(t);
  /// 生产事故形态：created_at == updated_at，任务已存在 20 分钟（> 默认 8 分钟阈值）
  const createdSec = Math.floor((NOW_MS - 20 * MIN) / 1000);
  injectFetcher(t, async () => ({
    jobId: "ext_test",
    status: "processing",
    rawProviderStatus: "running",
    rawProviderResponse: {
      id: "ext_test",
      status: "running",
      created_at: createdSec,
      updated_at: createdSec,
    },
  }));

  await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.FAILED, "provider 僵死必须终态化");
  assert.ok(job.errorMessage?.startsWith(WATCHDOG_STALLED_PREFIX));
  assert.ok(job.userSafeError, "必须有用户可见错误 + 重试入口文案");
  const stallLog = logs.find((l) => l.reason === "provider_stalled");
  assert.ok(stallLog, "必须记录 reason=provider_stalled 迁移日志");
  assert.ok(
    typeof stallLog!.snapshot === "string" &&
      (stallLog!.snapshot as string).includes("created_at"),
    "日志必须保留 provider 原始响应快照",
  );
});

test("AC-6 反例：provider running 但 updated_at 在推进 → 不误杀，保持 RUNNING", async (t) => {
  const job = installInMemoryJob(t, makeJob());
  const createdSec = Math.floor((NOW_MS - 20 * MIN) / 1000);
  injectFetcher(t, async () => ({
    jobId: "ext_test",
    status: "processing",
    rawProviderStatus: "running",
    rawProviderResponse: {
      status: "running",
      created_at: createdSec,
      updated_at: createdSec + 300,
    },
  }));

  await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.RUNNING);
  assert.equal(job.lastProviderStatus, "running");
  assert.ok(job.lastCheckedAt, "正常轮询必须刷新观察字段");
});

/// ---------- INV-6：状态更新幂等，终态不回退 ----------

test("INV-6 幂等：已 SUCCEEDED 的任务再次 reconcile（模拟重复回调/轮询）→ 不回退进行中", async (t) => {
  const job = installInMemoryJob(
    t,
    makeJob({
      status: VideoJobStatus.SUCCEEDED,
      finishedAt: new Date(),
      outputVideoUrl: "https://example.com/done.mp4",
    }),
  );
  let fetcherCalled = 0;
  injectFetcher(t, async () => {
    fetcherCalled++;
    return {
      jobId: "ext_test",
      status: "processing",
      rawProviderStatus: "running",
    };
  });

  const result = await reconcileVideoJob(job.id);
  assert.equal(fetcherCalled, 0, "终态任务不应再触碰 Provider");
  assert.equal(result?.status, VideoJobStatus.SUCCEEDED);
  assert.equal(job.status, VideoJobStatus.SUCCEEDED, "终态绝不回退");
  assert.equal(job.outputVideoUrl, "https://example.com/done.mp4");
});

test("INV-6 幂等：CAS 落空（并发已终态化）→ watchdog 不覆盖、不重复记日志", async (t) => {
  const job = installInMemoryJob(
    t,
    makeJob({ timeoutAt: new Date(NOW_MS - 5 * MIN) }),
  );
  const logs = captureTransitionLogs(t);
  const model = db.videoJob as unknown as Record<string, unknown>;
  /// 模拟并发：findUnique 读到 RUNNING 快照，但 updateMany 执行时已被另一路径终态化
  model.updateMany = async () => ({ count: 0 });
  injectFetcher(t, async () => {
    throw new Error("should not reach provider");
  });

  await reconcileVideoJob(job.id);
  assert.equal(logs.length, 0, "CAS 落空时不得记录迁移日志（避免假迁移）");
});
