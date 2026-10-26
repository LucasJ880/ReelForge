/**
 * C3：/api/internal/stitch/claim 只接受 POST（认领有副作用），GET 一律 405 且绝不认领；
 * inprocess（生产默认）下生产只有一个合成器，claim 一律 task=null。
 * 外部 runner（回滚路径）同步改用 POST。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { GET, POST } from "../src/app/api/internal/stitch/claim/route";

const SECRET = "claim-route-secret";

function patchModel(
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

function withEnv(t: TestContext, next: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(next)) {
    originals[key] = env[key];
    if (next[key] === undefined) delete env[key];
    else env[key] = next[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) delete env[key];
      else env[key] = originals[key];
    }
  });
}

function request(method: "GET" | "POST") {
  return new NextRequest("http://localhost/api/internal/stitch/claim", {
    method,
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function forbidDb(t: TestContext) {
  const touched: string[] = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async () => {
      touched.push("findMany");
      return [];
    },
    updateMany: async () => {
      touched.push("updateMany");
      return { count: 1 };
    },
  });
  return touched;
}

test("GET → 405（Allow: POST），且不碰数据库、不认领任何任务", async (t) => {
  withEnv(t, { CRON_SECRET: SECRET, STITCH_RUNTIME: "external" });
  const touched = forbidDb(t);
  const response = await GET();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.deepEqual(touched, []);
  /// 带合法鉴权的 GET 同样 405：预取 / 爬虫 / 健康检查不可能再把任务抢走
  void request("GET");
});

test("POST（external 回滚模式）→ CAS 认领一条并返回 attemptToken", async (t) => {
  withEnv(t, { CRON_SECRET: SECRET, STITCH_RUNTIME: "external" });
  const cas: Array<Record<string, unknown>> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async () => [
      {
        id: "fv_post_claim",
        status: FinalVideoStatus.PENDING,
        segmentCount: 1,
        targetDurationSec: 15,
        stitchAttempts: 0,
        postProduction: null,
        brief: { aspectRatio: "9:16" },
        segments: [
          {
            segmentIndex: 0,
            status: VideoJobStatus.SUCCEEDED,
            outputVideoUrl: "https://cdn.example.com/s.mp4",
            assignedAssets: null,
          },
        ],
      },
    ],
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      cas.push({ ...args.where, ...args.data });
      return { count: 1 };
    },
  });
  const response = await POST(request("POST"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { task: { finalVideoId: string; attemptToken: string } };
  assert.equal(body.task.finalVideoId, "fv_post_claim");
  assert.ok(body.task.attemptToken);
  assert.equal(cas[0]?.status, FinalVideoStatus.STITCHING);
});

test("POST（inprocess 生产默认）→ task=null：误触发的 runner 直接退出，不产出第二套合成结果", async (t) => {
  withEnv(t, { CRON_SECRET: SECRET, STITCH_RUNTIME: undefined, NODE_ENV: "production" });
  const touched = forbidDb(t);
  const response = await POST(request("POST"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { task: null, runtime: "inprocess" });
  assert.deepEqual(touched, []);
});

test("外部 runner 用 POST 认领", async () => {
  const runner = await readFile("scripts/stitch-runner.ts", "utf8");
  assert.match(
    runner,
    /fetch\(`\$\{APP_URL\}\/api\/internal\/stitch\/claim`, \{\s*method: "POST",/,
  );
  assert.doesNotMatch(runner, /method: "GET"/);
});
