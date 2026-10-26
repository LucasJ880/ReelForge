import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { createMediaBudget, type MediaBudget } from "@/lib/media/stitch-pipeline";
import {
  resolveStitchRuntimeMode,
  type StitchRuntimeMode,
} from "@/lib/media/stitch-runtime";
import {
  claimNextReadyFinalVideo,
  isStitchCandidateReady,
  MAX_STITCH_ATTEMPTS,
  runClaimedStitchAttempt,
  STITCH_CANDIDATE_PAGE_SIZE,
  type StitchAttemptOutcome,
} from "./stitch-service";

const STITCH_DISPATCH_LOCK_KEY = 7_805_050_05;
const GITHUB_WORKFLOW_FILE = "stitch-videos.yml";
const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
]);

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type StitchDispatchResult =
  | { outcome: "not_external"; pending: 0 }
  | { outcome: "lock_busy"; pending: 0 }
  | { outcome: "no_pending"; pending: 0 }
  | { outcome: "config_missing"; pending: number }
  | { outcome: "already_active"; pending: number }
  | { outcome: "dispatched"; pending: number }
  | { outcome: "github_error"; pending: number };

type LockedStitchDispatchResult = Exclude<
  StitchDispatchResult,
  { outcome: "not_external" | "lock_busy" }
>;

type DispatchLock = (
  work: () => Promise<LockedStitchDispatchResult>,
) => Promise<
  | { acquired: false }
  | { acquired: true; value: LockedStitchDispatchResult }
>;

interface DispatchConfig {
  owner: string;
  repository: string;
  ref: string;
  token: string;
}

export interface StitchDispatchOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  findPendingCount?: () => Promise<number>;
  withLock?: DispatchLock;
}

function stitchRuntimeMode(env: Env): StitchRuntimeMode {
  return resolveStitchRuntimeMode(env);
}

function resolveDispatchConfig(env: Env): DispatchConfig | null {
  const explicitRepository = (env.GITHUB_STITCH_REPOSITORY ?? "").trim();
  const derivedRepository =
    env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
      ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
      : "";
  const repositoryPath = explicitRepository || derivedRepository;
  const match = repositoryPath.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/,
  );
  const ref = (
    env.GITHUB_STITCH_REF ??
    env.VERCEL_GIT_COMMIT_REF ??
    ""
  ).trim();
  const token = (env.GITHUB_STITCH_DISPATCH_TOKEN ?? "").trim();
  if (!match || !ref || !token) return null;
  return {
    owner: match[1],
    repository: match[2],
    ref,
    token,
  };
}

async function findPendingReadyCount(): Promise<number> {
  let ready = 0;
  let cursor: string | undefined;
  while (true) {
    const candidates = await db.finalVideo.findMany({
      where: {
        status: FinalVideoStatus.PENDING,
        stitchAttempts: { lt: MAX_STITCH_ATTEMPTS },
        /// Keep RUNNING/FAILED/missing-URL blockers out of the candidate page.
        /// Missing expected segment rows can still pass `every`, so the exact
        /// count invariant is checked in memory below.
        segments: {
          every: {
            status: VideoJobStatus.SUCCEEDED,
            outputVideoUrl: { not: null },
          },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: STITCH_CANDIDATE_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        segmentCount: true,
        segments: {
          select: { status: true, outputVideoUrl: true },
        },
      },
    });
    ready += candidates.filter(isStitchCandidateReady).length;

    if (candidates.length < STITCH_CANDIDATE_PAGE_SIZE) break;
    const nextCursor = candidates.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return ready;
}

async function withPostgresDispatchLock(
  work: () => Promise<LockedStitchDispatchResult>,
): Promise<
  | { acquired: false }
  | { acquired: true; value: LockedStitchDispatchResult }
> {
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${STITCH_DISPATCH_LOCK_KEY}) AS acquired
      `;
      if (!rows[0]?.acquired) return { acquired: false as const };
      return { acquired: true as const, value: await work() };
    },
    { maxWait: 1_000, timeout: 12_000 },
  );
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "reelforge-stitch-dispatcher",
  };
}

async function dispatchGithubWorkflow(args: {
  config: DispatchConfig;
  fetchImpl: typeof fetch;
}): Promise<"already_active" | "dispatched" | "github_error"> {
  const { owner, repository, ref, token } = args.config;
  const workflowUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/${encodeURIComponent(GITHUB_WORKFLOW_FILE)}`;
  const headers = githubHeaders(token);
  try {
    const activeResponse = await args.fetchImpl(
      `${workflowUrl}/runs?per_page=20`,
      {
        method: "GET",
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!activeResponse.ok) return "github_error";
    const payload = (await activeResponse.json()) as {
      workflow_runs?: Array<{ status?: string | null }>;
    };
    if (
      (payload.workflow_runs ?? []).some((run) =>
        ACTIVE_RUN_STATUSES.has(run.status ?? ""),
      )
    ) {
      return "already_active";
    }

    const dispatchResponse = await args.fetchImpl(`${workflowUrl}/dispatches`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    return dispatchResponse.ok ? "dispatched" : "github_error";
  } catch {
    return "github_error";
  }
}

/**
 * Vercel's minute cron calls this coordinator. It only dispatches the existing
 * external runner when ready work exists. The PostgreSQL advisory lock closes
 * concurrent cron retries, GitHub active-run detection suppresses repeated
 * dispatches, and the workflow's concurrency group protects the claim CAS.
 */
export async function dispatchExternalStitchRunner(
  options: StitchDispatchOptions = {},
): Promise<StitchDispatchResult> {
  const env = options.env ?? process.env;
  if (stitchRuntimeMode(env) !== "external") {
    return { outcome: "not_external", pending: 0 };
  }

  const findPending = options.findPendingCount ?? findPendingReadyCount;
  const withLock = options.withLock ?? withPostgresDispatchLock;
  const fetchImpl = options.fetchImpl ?? fetch;
  const locked = await withLock(async () => {
    const pending = await findPending();
    if (pending === 0) return { outcome: "no_pending", pending: 0 };

    const config = resolveDispatchConfig(env);
    if (!config) return { outcome: "config_missing", pending };
    const outcome = await dispatchGithubWorkflow({ config, fetchImpl });
    return { outcome, pending };
  });
  if (!locked.acquired) return { outcome: "lock_busy", pending: 0 };
  return locked.value;
}

// ---------------------------------------------------------------------------
// inprocess：专用 Vercel 函数里认领 + 用应用内合成器合成（C3 生产默认）
// ---------------------------------------------------------------------------

/** stitch-dispatch 路由的 maxDuration（秒）；路由与这里共用，改一处即可 */
export const STITCH_DISPATCH_MAX_DURATION_SEC = 300;
/// 剩余不足这么多就不再开始新任务（防止开始一条注定被平台杀掉的合成）
const DEFAULT_MIN_START_BUDGET_MS = 150_000;
/// 合成截止 = 平台硬上限 - 这段余量：留给预算中止后的「放回 PENDING」与日志
const DEFAULT_DEADLINE_SAFETY_MS = 25_000;
/// ffmpeg 结束后留给上传成片 / 缩略图 / 字幕 + 内容审核 + 落库的时间
const DEFAULT_UPLOAD_RESERVE_MS = 20_000;
const DEFAULT_MAX_TASKS_PER_TICK = 4;
/// 全局同时在合成的上限：每分钟的 cron 调用彼此重叠（单次最长 300s），不设上限时最多 5 路
/// 同时 ffmpeg；Fluid compute 可能把它们放进同一实例抢 CPU，越抢越容易超预算被放回。
const DEFAULT_MAX_CONCURRENT = 3;

/**
 * 粗估一条成片在函数里合成要多久（毫秒）。单遍合成本地实测（M4 限 2 线程）约
 * 0.45s / 成片秒，Vercel 2 vCPU 按慢 2–2.5 倍算，再留一倍余量 + 固定开销（下载、
 * 尾卡渲染、探测、上传、审核、落库）。只用于「剩余预算放不放得下」的挑选，
 * 不是硬限制——真超了由 deadline 中止并放回 PENDING。
 */
export function estimateComposeMs(candidate: { targetDurationSec: number }): number {
  const seconds = Math.max(5, Number(candidate.targetDurationSec) || 15) + 3;
  return 20_000 + seconds * 2_000;
}

export type InprocessStitchTickResult = {
  outcome: "no_pending" | "inprocess_idle" | "stitched_inprocess";
  pending: number;
  claimed: number;
  succeeded: number;
  failed: number;
  requeued: number;
  lost: number;
  stoppedBecause: "no_pending" | "drained" | "budget" | "max_tasks" | "concurrency";
  elapsedMs: number;
};

export interface InprocessStitchTickOptions {
  env?: Env;
  now?: () => number;
  /** 本次函数调用开始的时刻（epoch ms）；默认 now() */
  startedAt?: number;
  maxDurationMs?: number;
  minStartBudgetMs?: number;
  deadlineSafetyMs?: number;
  uploadReserveMs?: number;
  maxTasks?: number;
  /** 全局同时合成上限（STITCH_INPROCESS_MAX_CONCURRENT，默认 3） */
  maxConcurrent?: number;
  /** 其它调用正在合成的条数（STITCHING 且在一个函数寿命之内认领的） */
  countInflight?: (since: Date) => Promise<number>;
  findPendingCount?: () => Promise<number>;
  claim?: (accept: (candidate: { targetDurationSec: number }) => boolean) => Promise<{
    finalVideoId: string;
    attemptToken: string;
  } | null>;
  runAttempt?: (args: {
    finalVideoId: string;
    attemptToken: string;
    budget: MediaBudget;
  }) => Promise<StitchAttemptOutcome>;
}

function envNumber(env: Env, key: string, fallback: number): number {
  const raw = Number(env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * 一次 cron 调用：在时间预算内逐条认领（与 claimStitchTask 同一个 CAS：
 * PENDING → STITCHING + attemptToken + startedAt）并在本进程合成。
 *
 *   - 剩余 < minStartBudget（默认 150s）不开始新任务；
 *   - 第一条总会尝试（否则超长片永远没人认领）；之后只挑估算放得下的；
 *   - 合成 deadline = 硬上限 - 余量：超了就中止 ffmpeg、放回 PENDING（attempts+1）；
 *   - 函数被平台杀掉 → 行停在 STITCHING → sweep-service 30 分钟后放回 PENDING；
 *   - 不持有任何全局锁（长事务不能跨 300s 合成）：每分钟的调用彼此重叠时靠 CAS 互斥，
 *     同时合成条数由 maxConcurrent（默认 3）兜住。
 */
export async function runInprocessStitchTick(
  options: InprocessStitchTickOptions = {},
): Promise<InprocessStitchTickResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const startedAt = options.startedAt ?? now();
  const maxDurationMs = options.maxDurationMs ?? STITCH_DISPATCH_MAX_DURATION_SEC * 1000;
  const minStartBudgetMs =
    options.minStartBudgetMs ??
    envNumber(env, "STITCH_INPROCESS_MIN_START_SEC", DEFAULT_MIN_START_BUDGET_MS / 1000) * 1000;
  const deadlineSafetyMs = options.deadlineSafetyMs ?? DEFAULT_DEADLINE_SAFETY_MS;
  const uploadReserveMs = options.uploadReserveMs ?? DEFAULT_UPLOAD_RESERVE_MS;
  const maxTasks =
    options.maxTasks ?? envNumber(env, "STITCH_INPROCESS_MAX_TASKS", DEFAULT_MAX_TASKS_PER_TICK);
  const maxConcurrent =
    options.maxConcurrent ??
    envNumber(env, "STITCH_INPROCESS_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT);
  const hardDeadline = startedAt + maxDurationMs;
  const composeDeadline = hardDeadline - deadlineSafetyMs;

  const findPending = options.findPendingCount ?? findPendingReadyCount;
  const countInflight =
    options.countInflight ??
    ((since: Date) =>
      db.finalVideo.count({
        where: { status: FinalVideoStatus.STITCHING, startedAt: { gt: since } },
      }));
  const claim =
    options.claim ??
    (async (accept) => {
      const claimed = await claimNextReadyFinalVideo({
        prepare: () => null,
        accept: (candidate) => accept(candidate),
      });
      return claimed
        ? { finalVideoId: claimed.finalVideoId, attemptToken: claimed.attemptToken }
        : null;
    });
  const runAttempt =
    options.runAttempt ??
    ((args) =>
      runClaimedStitchAttempt({
        finalVideoId: args.finalVideoId,
        attemptToken: args.attemptToken,
        budget: args.budget,
      }));

  const result: InprocessStitchTickResult = {
    outcome: "no_pending",
    pending: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    requeued: 0,
    lost: 0,
    stoppedBecause: "no_pending",
    elapsedMs: 0,
  };

  result.pending = await findPending();
  if (result.pending === 0) {
    result.elapsedMs = now() - startedAt;
    return result;
  }

  while (true) {
    if (result.claimed >= maxTasks) {
      result.stoppedBecause = "max_tasks";
      break;
    }
    if (hardDeadline - now() < minStartBudgetMs) {
      result.stoppedBecause = "budget";
      break;
    }
    /// 只数「一个函数寿命之内」认领的：被平台杀掉、停在 STITCHING 的旧行不占名额（清扫器会收回）
    const inflight = await countInflight(new Date(now() - maxDurationMs - 60_000));
    if (inflight >= maxConcurrent) {
      result.stoppedBecause = "concurrency";
      break;
    }
    const isFirst = result.claimed === 0;
    const available = composeDeadline - now() - uploadReserveMs;
    const task = await claim(
      (candidate) => isFirst || estimateComposeMs(candidate) <= available,
    );
    if (!task) {
      result.stoppedBecause = "drained";
      break;
    }
    result.claimed += 1;
    const budget = createMediaBudget({
      deadlineAt: composeDeadline,
      reserveMs: uploadReserveMs,
      now,
    });
    let outcome: StitchAttemptOutcome;
    try {
      outcome = await runAttempt({ ...task, budget });
    } catch (err) {
      /// runClaimedStitchAttempt 自己不抛；走到这里说明落库本身出了问题（数据库抖动）。
      /// 行停在 STITCHING，清扫器会收回；本轮不再继续认领。
      console.error("[stitch-dispatch:inprocess] attempt crashed", {
        finalVideoId: task.finalVideoId,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
      });
      result.failed += 1;
      result.stoppedBecause = "drained";
      break;
    }
    if (outcome.kind === "succeeded") result.succeeded += 1;
    else if (outcome.kind === "failed") result.failed += 1;
    else if (outcome.kind === "requeued") result.requeued += 1;
    else result.lost += 1;
    console.log(
      JSON.stringify({
        event: "stitch_inprocess_attempt",
        finalVideoId: task.finalVideoId,
        outcome: outcome.kind,
        status: outcome.result.status,
        elapsedMs: now() - startedAt,
      }),
    );
  }

  result.outcome = result.claimed > 0 ? "stitched_inprocess" : "inprocess_idle";
  result.elapsedMs = now() - startedAt;
  return result;
}

export type StitchDispatchTickResult =
  | { mode: "inprocess"; inprocess: InprocessStitchTickResult }
  | { mode: "external" | "local"; dispatch: StitchDispatchResult };

/** stitch-dispatch cron 的总入口：按运行模式进程内合成 / 派发 GitHub runner / 什么都不做。 */
export async function runStitchDispatchTick(options: {
  env?: Env;
  startedAt?: number;
  inprocess?: InprocessStitchTickOptions;
  external?: StitchDispatchOptions;
} = {}): Promise<StitchDispatchTickResult> {
  const env = options.env ?? process.env;
  const mode = stitchRuntimeMode(env);
  if (mode === "inprocess") {
    return {
      mode,
      inprocess: await runInprocessStitchTick({
        env,
        startedAt: options.startedAt,
        ...options.inprocess,
      }),
    };
  }
  return {
    mode,
    dispatch: await dispatchExternalStitchRunner({ env, ...options.external }),
  };
}

export const __test__ = {
  resolveDispatchConfig,
  stitchRuntimeMode,
  dispatchGithubWorkflow,
  findPendingReadyCount,
  STITCH_DISPATCH_LOCK_KEY,
  DEFAULT_MIN_START_BUDGET_MS,
  DEFAULT_DEADLINE_SAFETY_MS,
};
