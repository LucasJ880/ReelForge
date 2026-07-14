import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import {
  GET,
  POST,
} from "../src/app/api/cron/stitch-dispatch/route";
import {
  stitchDispatchAuthFailureSchema,
  stitchDispatchFailureSchema,
  stitchDispatchHeartbeatSchema,
  stitchDispatchResponseSchema,
  stitchDispatchSuccessSchema,
} from "../src/lib/contracts/stitch-dispatch";
import { db } from "../src/lib/db";

const SECRET = "stitch-dispatch-contract-secret";
const ENV_KEYS = [
  "CRON_SECRET",
  "STITCH_RUNTIME",
  "GITHUB_STITCH_REPOSITORY",
  "GITHUB_STITCH_REF",
  "GITHUB_STITCH_DISPATCH_TOKEN",
  "VERCEL_GIT_REPO_OWNER",
  "VERCEL_GIT_REPO_SLUG",
  "VERCEL_GIT_COMMIT_REF",
] as const;

function preserveEnvironment(t: TestContext) {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function clearDispatchConfig() {
  for (const key of ENV_KEYS) {
    if (key !== "CRON_SECRET" && key !== "STITCH_RUNTIME") {
      delete process.env[key];
    }
  }
}

function request(method: "GET" | "POST", bearer = SECRET) {
  return new NextRequest("http://localhost/api/cron/stitch-dispatch", {
    method,
    headers: { authorization: `Bearer ${bearer}` },
  });
}

function patch(
  t: TestContext,
  target: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

function installReadyDatabase(t: TestContext) {
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async (
      work: (tx: { $queryRaw: () => Promise<Array<{ acquired: boolean }>> }) =>
        Promise<unknown>,
    ) => work({ $queryRaw: async () => [{ acquired: true }] }),
  });
  patch(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async () => [
      {
        id: "final-ready-contract",
        segmentCount: 1,
        segments: [
          {
            status: VideoJobStatus.SUCCEEDED,
            outputVideoUrl: "https://assets.example.test/segment.mp4",
          },
        ],
      },
    ],
  });
}

test("H1 stitch-dispatch auth failures retain the shared strict machine shape", async (t) => {
  preserveEnvironment(t);
  delete process.env.CRON_SECRET;

  const missing = await GET(request("GET"));
  assert.equal(missing.status, 503);
  assert.deepEqual(
    stitchDispatchAuthFailureSchema.parse(await missing.json()),
    { error: "service unavailable" },
  );

  process.env.CRON_SECRET = SECRET;
  const wrong = await GET(request("GET", "wrong-secret"));
  assert.equal(wrong.status, 401);
  assert.deepEqual(stitchDispatchAuthFailureSchema.parse(await wrong.json()), {
    error: "unauthorized",
  });
});

test("H1 stitch-dispatch GET and POST share one strict success contract", async (t) => {
  preserveEnvironment(t);
  process.env.CRON_SECRET = SECRET;
  process.env.STITCH_RUNTIME = "local";
  clearDispatchConfig();
  assert.equal(POST, GET, "POST must be the exact GET handler contract");

  for (const [method, handler] of [
    ["GET", GET],
    ["POST", POST],
  ] as const) {
    const response = await handler(request(method));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(stitchDispatchResponseSchema.parse(body), body);
    assert.deepEqual(stitchDispatchSuccessSchema.parse(body), body);
    assert.deepEqual(stitchDispatchHeartbeatSchema.parse(body.heartbeat), body.heartbeat);
    assert.deepEqual(Object.keys(body), [
      "ok",
      "dispatched",
      "outcome",
      "pending",
      "heartbeat",
    ]);
    assert.equal(body.outcome, "not_external");
    assert.equal(body.dispatched, false);
    assert.equal(body.heartbeat.outcome, "skipped");
  }
});

test("H1 stitch-dispatch 503 config failure is stable and secret-free", async (t) => {
  preserveEnvironment(t);
  installReadyDatabase(t);
  process.env.CRON_SECRET = SECRET;
  process.env.STITCH_RUNTIME = "external";
  clearDispatchConfig();

  const response = await GET(request("GET"));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(stitchDispatchFailureSchema.parse(body), body);
  assert.deepEqual(body, {
    ...body,
    ok: false,
    code: "STITCH_DISPATCH_CONFIG_MISSING",
    error: "external stitch dispatcher unavailable",
    retryable: false,
    action: "contact_support",
    outcome: "config_missing",
    pending: 1,
  });
  assert.doesNotMatch(JSON.stringify(body), /GITHUB|TOKEN|Bearer|secret/i);
});

test("H1 stitch-dispatch 502 upstream failure is stable and retryable", async (t) => {
  preserveEnvironment(t);
  installReadyDatabase(t);
  process.env.CRON_SECRET = SECRET;
  process.env.STITCH_RUNTIME = "external";
  process.env.GITHUB_STITCH_REPOSITORY = "example/reelforge";
  process.env.GITHUB_STITCH_REF = "main";
  process.env.GITHUB_STITCH_DISPATCH_TOKEN = "upstream-secret-never-output";
  patch(t, globalThis as unknown as Record<string, unknown>, {
    fetch: async () => new Response(null, { status: 503 }),
  });

  const response = await POST(request("POST"));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(stitchDispatchFailureSchema.parse(body), body);
  assert.equal(body.code, "STITCH_DISPATCH_UPSTREAM_ERROR");
  assert.equal(body.outcome, "github_error");
  assert.equal(body.retryable, true);
  assert.equal(body.action, "wait");
  assert.doesNotMatch(JSON.stringify(body), /upstream-secret|Bearer/i);
});

test("H1 stitch-dispatch dispatched success keeps response and heartbeat aligned", async (t) => {
  preserveEnvironment(t);
  installReadyDatabase(t);
  process.env.CRON_SECRET = SECRET;
  process.env.STITCH_RUNTIME = "external";
  process.env.GITHUB_STITCH_REPOSITORY = "example/reelforge";
  process.env.GITHUB_STITCH_REF = "main";
  process.env.GITHUB_STITCH_DISPATCH_TOKEN = "dispatch-secret-never-output";
  let fetchCalls = 0;
  patch(t, globalThis as unknown as Record<string, unknown>, {
    fetch: async (_input: URL | RequestInfo, init?: RequestInit) => {
      fetchCalls += 1;
      if ((init?.method ?? "GET") === "GET") {
        return Response.json({ workflow_runs: [] });
      }
      return new Response(null, { status: 204 });
    },
  });

  const response = await GET(request("GET"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(stitchDispatchSuccessSchema.parse(body), body);
  assert.equal(body.outcome, "dispatched");
  assert.equal(body.dispatched, true);
  assert.equal(body.pending, 1);
  assert.equal(body.heartbeat.outcome, "ok");
  assert.equal(fetchCalls, 2);
  assert.doesNotMatch(JSON.stringify(body), /dispatch-secret|Bearer/i);
});

test("H1 stitch-dispatch 500 sanitizes thrown diagnostics", async (t) => {
  preserveEnvironment(t);
  process.env.CRON_SECRET = SECRET;
  process.env.STITCH_RUNTIME = "external";
  clearDispatchConfig();
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      throw new Error(
        "postgresql://private-user:private-password@secret-host/db?token=leak",
      );
    },
  });

  const response = await GET(request("GET"));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(stitchDispatchFailureSchema.parse(body), body);
  assert.equal(body.code, "STITCH_DISPATCH_INTERNAL_ERROR");
  assert.equal(body.outcome, "internal_error");
  assert.equal(body.pending, 0);
  assert.doesNotMatch(
    JSON.stringify(body),
    /postgresql|private-user|private-password|secret-host|token|leak/i,
  );
  assert.equal(
    stitchDispatchResponseSchema.safeParse({
      ...body,
      leakedDiagnostic: "must be rejected",
    }).success,
    false,
    "strict schemas reject accidental diagnostic fields",
  );
});
