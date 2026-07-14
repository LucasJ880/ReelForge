import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  isStitchCandidateReady,
  MAX_STITCH_ATTEMPTS,
  STITCH_CANDIDATE_PAGE_SIZE,
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

function stitchRuntimeMode(env: Env): "local" | "external" {
  const explicit = (env.STITCH_RUNTIME ?? "").trim().toLowerCase();
  if (explicit === "local") return "local";
  if (explicit === "external") return "external";
  return env.NODE_ENV === "production" ? "external" : "local";
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

export const __test__ = {
  resolveDispatchConfig,
  stitchRuntimeMode,
  dispatchGithubWorkflow,
  findPendingReadyCount,
  STITCH_DISPATCH_LOCK_KEY,
};
