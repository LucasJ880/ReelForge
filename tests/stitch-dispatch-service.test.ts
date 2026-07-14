import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  dispatchExternalStitchRunner,
  type StitchDispatchOptions,
  __test__ as dispatchTest,
} from "../src/lib/services/stitch-dispatch-service";

const CONFIGURED_ENV = {
  STITCH_RUNTIME: "external",
  GITHUB_STITCH_REPOSITORY: "LucasJ880/ReelForge",
  GITHUB_STITCH_REF: "main",
  GITHUB_STITCH_DISPATCH_TOKEN: "test-secret-never-sent-to-output",
};

const acquiredLock: NonNullable<StitchDispatchOptions["withLock"]> = async (
  work,
) => ({ acquired: true, value: await work() });

test("RF-005 dispatch：非 external 或 advisory lock 忙时不查任务、不触发 workflow", async () => {
  let pendingCalls = 0;
  let fetchCalls = 0;
  const findPendingCount = async () => {
    pendingCalls += 1;
    return 1;
  };
  const fetchImpl = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const local = await dispatchExternalStitchRunner({
    env: { STITCH_RUNTIME: "local" },
    findPendingCount,
    fetchImpl,
    withLock: acquiredLock,
  });
  assert.deepEqual(local, { outcome: "not_external", pending: 0 });

  const busy = await dispatchExternalStitchRunner({
    env: CONFIGURED_ENV,
    findPendingCount,
    fetchImpl,
    withLock: async () => ({ acquired: false }),
  });
  assert.deepEqual(busy, { outcome: "lock_busy", pending: 0 });
  assert.equal(pendingCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("RF-005 dispatch：无待拼任务时不要求 GitHub 凭证，也不发网络请求", async () => {
  let fetchCalls = 0;
  const result = await dispatchExternalStitchRunner({
    env: { STITCH_RUNTIME: "external" },
    findPendingCount: async () => 0,
    withLock: acquiredLock,
    fetchImpl: (async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    }) as typeof fetch,
  });
  assert.deepEqual(result, { outcome: "no_pending", pending: 0 });
  assert.equal(fetchCalls, 0);
});

test("RF-005 dispatch：有任务但凭证不完整时 fail-closed，结果不泄漏配置名或值", async () => {
  let fetchCalls = 0;
  const result = await dispatchExternalStitchRunner({
    env: { STITCH_RUNTIME: "external" },
    findPendingCount: async () => 2,
    withLock: acquiredLock,
    fetchImpl: (async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    }) as typeof fetch,
  });
  assert.deepEqual(result, { outcome: "config_missing", pending: 2 });
  assert.equal(fetchCalls, 0);
  assert.doesNotMatch(
    JSON.stringify(result),
    /GITHUB|TOKEN|Bearer|test-secret/i,
  );
});

test("RF-005 dispatch 幂等：已有 queued/in_progress runner 时不重复 dispatch", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const result = await dispatchExternalStitchRunner({
    env: CONFIGURED_ENV,
    findPendingCount: async () => 3,
    withLock: acquiredLock,
    fetchImpl: (async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
      });
      return Response.json({
        workflow_runs: [{ status: "queued" }, { status: "completed" }],
      });
    }) as typeof fetch,
  });

  assert.deepEqual(result, { outcome: "already_active", pending: 3 });
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
  assert.ok(calls[0].url.endsWith("/runs?per_page=20"));
});

test("RF-005 dispatch：待拼任务存在且无 active runner 时只 dispatch 一次", async () => {
  const calls: Array<{
    url: string;
    method: string;
    body: string | null;
  }> = [];
  const result = await dispatchExternalStitchRunner({
    env: CONFIGURED_ENV,
    findPendingCount: async () => 1,
    withLock: acquiredLock,
    fetchImpl: (async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      if ((init?.method ?? "GET") === "GET") {
        return Response.json({ workflow_runs: [{ status: "completed" }] });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  });

  assert.deepEqual(result, { outcome: "dispatched", pending: 1 });
  assert.deepEqual(calls.map((call) => call.method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(calls[1].body ?? "{}"), { ref: "main" });
  assert.doesNotMatch(JSON.stringify({ result, calls }), /test-secret/i);
});

test("RF-005 pending detector：只计算段齐全、SUCCEEDED 且有 URL 的 FinalVideo", async (t: TestContext) => {
  const model = db.finalVideo as unknown as Record<string, unknown>;
  const original = model.findMany;
  model.findMany = async () => [
    {
      status: FinalVideoStatus.PENDING,
      segmentCount: 2,
      segments: [
        { status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://cdn/a.mp4" },
        { status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://cdn/b.mp4" },
      ],
    },
    {
      status: FinalVideoStatus.PENDING,
      segmentCount: 2,
      segments: [
        { status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://cdn/a.mp4" },
      ],
    },
    {
      status: FinalVideoStatus.PENDING,
      segmentCount: 1,
      segments: [{ status: VideoJobStatus.RUNNING, outputVideoUrl: null }],
    },
  ];
  t.after(() => {
    model.findMany = original;
  });

  assert.equal(await dispatchTest.findPendingReadyCount(), 1);
});

test("P0 回归：20+ 个较旧缺段 PENDING 不得遮住后续 ready dispatch", async (t: TestContext) => {
  const blockers = Array.from({ length: 25 }, (_, index) => ({
    id: `fv_blocker_${String(index).padStart(2, "0")}`,
    status: FinalVideoStatus.PENDING,
    segmentCount: 2,
    /// `segments.every(...)` 会让“预期第二段尚未创建”的记录通过 SQL
    /// 预过滤，因此仍必须靠稳定分页越过整页 blocker。
    segments: [
      {
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: `https://cdn/blocker-${index}.mp4`,
      },
    ],
  }));
  const ready = {
    id: "fv_ready_after_blockers",
    status: FinalVideoStatus.PENDING,
    segmentCount: 2,
    segments: [
      { status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://cdn/a.mp4" },
      { status: VideoJobStatus.SUCCEEDED, outputVideoUrl: "https://cdn/b.mp4" },
    ],
  };
  const rows = [...blockers, ready];
  const queries: Array<Record<string, unknown>> = [];
  const model = db.finalVideo as unknown as Record<string, unknown>;
  const original = model.findMany;
  model.findMany = async (args: {
    cursor?: { id: string };
    skip?: number;
    take: number;
    where: Record<string, unknown>;
  }) => {
    queries.push(args as unknown as Record<string, unknown>);
    const cursorIndex = args.cursor
      ? rows.findIndex((row) => row.id === args.cursor?.id)
      : -1;
    const start = args.cursor ? cursorIndex + (args.skip ?? 0) : 0;
    return rows.slice(start, start + args.take);
  };
  t.after(() => {
    model.findMany = original;
  });

  assert.equal(await dispatchTest.findPendingReadyCount(), 1);
  assert.equal(queries.length, 2, "必须翻到第二页才能发现 ready 任务");
  assert.deepEqual(
    (queries[1]?.cursor as { id: string } | undefined)?.id,
    blockers[19].id,
  );
  assert.equal(queries[1]?.skip, 1);
  assert.deepEqual(
    (
      queries[0]?.where as {
        segments?: { every?: { status?: string; outputVideoUrl?: unknown } };
      }
    ).segments?.every,
    {
      status: VideoJobStatus.SUCCEEDED,
      outputVideoUrl: { not: null },
    },
    "数据库查询也应排除已知 RUNNING/FAILED/缺 URL blocker",
  );
});
