import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { machineVideoCreateResponseSchema } from "../src/lib/contracts/machine-video-api";
import { createMachineVideoTaskPostHandler } from "../src/app/api/machine/video-tasks/route";
import { createMachineVideoTaskGetHandler } from "../src/app/api/machine/video-tasks/[id]/route";
import { authenticateMachineVideoRequest } from "../src/lib/machine-video-auth";
import {
  createMachineVideoTaskWithStore,
  type MachineVideoTaskRecord,
  type MachineVideoTaskStore,
} from "../src/lib/services/machine-video-task-service";
import { projectMachineVideoTask } from "../src/lib/services/machine-video-task-status";

const TOKEN = "machine-video-token-not-cron";
const USER_ID = "user_owner_1";

function request(url: string, init: { method?: string; token?: string; key?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.key) headers.set("idempotency-key", init.key);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function withMachineEnv(cron = "cron-secret-value-123") {
  const previous = {
    token: process.env.MACHINE_VIDEO_API_TOKEN,
    userId: process.env.MACHINE_VIDEO_API_USER_ID,
    cron: process.env.CRON_SECRET,
  };
  process.env.MACHINE_VIDEO_API_TOKEN = TOKEN;
  process.env.MACHINE_VIDEO_API_USER_ID = USER_ID;
  process.env.CRON_SECRET = cron;
  return () => {
    if (previous.token === undefined) delete process.env.MACHINE_VIDEO_API_TOKEN;
    else process.env.MACHINE_VIDEO_API_TOKEN = previous.token;
    if (previous.userId === undefined) delete process.env.MACHINE_VIDEO_API_USER_ID;
    else process.env.MACHINE_VIDEO_API_USER_ID = previous.userId;
    if (previous.cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous.cron;
  };
}

function memoryStore(options: {
  email?: string;
  disabledAt?: Date | null;
  ownedAssetIds?: string[];
} = {}) {
  const tasks = new Map<string, MachineVideoTaskRecord>();
  let sequence = 0;
  const owned = new Set(options.ownedAssetIds ?? []);
  const store: MachineVideoTaskStore = {
    async findUser(userId) {
      if (userId !== USER_ID) return null;
      return {
        id: USER_ID,
        email: options.email ?? "owner@example.com",
        disabledAt: options.disabledAt ?? null,
      };
    },
    async findByIdempotency(userId, idempotencyKey) {
      return [...tasks.values()].find((task) => task.userId === userId && task.idempotencyKey === idempotencyKey) ?? null;
    },
    async insert(record) {
      const existing = [...tasks.values()].find(
        (task) => task.userId === record.userId && task.idempotencyKey === record.idempotencyKey,
      );
      if (existing) throw new Error("MACHINE_VIDEO_TASK_CONFLICT");
      const saved = { ...record, id: `c${String(++sequence).padStart(24, "0")}` };
      tasks.set(saved.id, saved);
      return saved;
    },
    async findOwnedImageIds(_userId, assetIds) {
      return assetIds.filter((id) => owned.has(id));
    },
  };
  return { store, tasks };
}

const copy = {
  prompt: "三十秒内讲清这款窗帘怎么一键遮光，开头先给刺眼阳光。",
  voiceoverScript: "早上阳光太刺眼。按一下，窗帘自己合上。",
  durationSec: 15 as const,
  aspectRatio: "9:16" as const,
  assetIds: [] as string[],
};

test("机器鉴权：未配置、错误凭证、CRON_SECRET 都不能创建任务", async () => {
  const restore = withMachineEnv();
  try {
    delete process.env.MACHINE_VIDEO_API_TOKEN;
    const missing = authenticateMachineVideoRequest(request("http://localhost/api/machine/video-tasks", { method: "POST", token: TOKEN }));
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.response.status, 503);
      const text = await missing.response.text();
      assert.doesNotMatch(text, /CRON_SECRET|MACHINE_VIDEO_API_TOKEN|Bearer/i);
    }

    process.env.MACHINE_VIDEO_API_TOKEN = TOKEN;
    const cronAsToken = authenticateMachineVideoRequest(
      request("http://localhost/api/machine/video-tasks", { method: "POST", token: "cron-secret-value-123" }),
    );
    assert.equal(cronAsToken.ok, false);
    if (!cronAsToken.ok) assert.equal(cronAsToken.response.status, 401);

    process.env.MACHINE_VIDEO_API_TOKEN = "cron-secret-value-123";
    const sameSecret = authenticateMachineVideoRequest(
      request("http://localhost/api/machine/video-tasks", { method: "POST", token: "cron-secret-value-123" }),
    );
    assert.equal(sameSecret.ok, false);
    if (!sameSecret.ok) assert.equal(sameSecret.response.status, 503);
  } finally {
    restore();
  }
});

test("创建：参数校验、跨账号字段、同键重放和参数冲突", async () => {
  const restore = withMachineEnv();
  const { store, tasks } = memoryStore();
  const handler = createMachineVideoTaskPostHandler({
    createTask: (input) => createMachineVideoTaskWithStore(store, input),
  });
  try {
    const missingKey = await handler(request("http://localhost/api/machine/video-tasks", {
      method: "POST",
      token: TOKEN,
      body: copy,
    }));
    assert.equal(missingKey.status, 400);
    assert.equal((await missingKey.json()).code, "IDEMPOTENCY_KEY_REQUIRED");

    const invalid = await handler(request("http://localhost/api/machine/video-tasks", {
      method: "POST",
      token: TOKEN,
      key: "same-key",
      body: { prompt: "太短", durationSec: 15 },
    }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "VALIDATION_FAILED");

    const foreignUser = await handler(request("http://localhost/api/machine/video-tasks", {
      method: "POST",
      token: TOKEN,
      key: "same-key",
      body: { ...copy, userId: "someone-else" },
    }));
    assert.equal(foreignUser.status, 400);

    const created = await handler(request("http://localhost/api/machine/video-tasks", {
      method: "POST",
      token: TOKEN,
      key: "same-key",
      body: copy,
    }));
    assert.equal(created.status, 201);
    const first = machineVideoCreateResponseSchema.parse(await created.json());
    assert.equal(first.status, "awaiting_confirmation");
    assert.equal(first.stage, "needs_storyboard");
    assert.equal(first.started, false);
    assert.equal(first.briefId, null);
    assert.equal(first.deliverableUrl, null);
    assert.equal(first.replayed, false);
    assert.equal(tasks.size, 1);

    const replay = await handler(request("http://localhost/api/machine/video-tasks", {
      method: "POST",
      token: TOKEN,
      key: "same-key",
      body: copy,
    }));
    assert.equal(replay.status, 200);
    const second = machineVideoCreateResponseSchema.parse(await replay.json());
    assert.equal(second.taskId, first.taskId);
    assert.equal(second.replayed, true);
    assert.equal(tasks.size, 1);

    const conflict = await handler(request("http://localhost/api/machine/video-tasks", {
      method: "POST",
      token: TOKEN,
      key: "same-key",
      body: { ...copy, durationSec: 30 },
    }));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "IDEMPOTENCY_CONFLICT");
    assert.equal(tasks.size, 1);
  } finally {
    restore();
  }
});

test("创建：并发同键只保留一条，停用账号和别人的素材不能建任务", async () => {
  const { store, tasks } = memoryStore({ ownedAssetIds: ["asset_ok"] });
  const [left, right] = await Promise.all([
    createMachineVideoTaskWithStore(store, { userId: USER_ID, idempotencyKey: "race", request: copy }),
    createMachineVideoTaskWithStore(store, { userId: USER_ID, idempotencyKey: "race", request: copy }),
  ]);
  assert.equal(left.view.taskId, right.view.taskId);
  assert.equal(tasks.size, 1);
  assert.equal([left.replayed, right.replayed].filter(Boolean).length, 1);

  const disabled = memoryStore({ disabledAt: new Date() });
  await assert.rejects(
    () => createMachineVideoTaskWithStore(disabled.store, { userId: USER_ID, idempotencyKey: "x", request: copy }),
    (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 403,
  );

  const demo = memoryStore({ email: "demo@aivora.app" });
  await assert.rejects(
    () => createMachineVideoTaskWithStore(demo.store, { userId: USER_ID, idempotencyKey: "x", request: copy }),
    (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 403,
  );

  await assert.rejects(
    () => createMachineVideoTaskWithStore(store, {
      userId: USER_ID,
      idempotencyKey: "assets",
      request: { ...copy, assetIds: ["asset_other_user"] },
    }),
    (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 404,
  );
});

test("查询：未授权、跨用户、待确认、处理中、失败、可交付和供应商未知", async () => {
  const restore = withMachineEnv();
  const taskId = "c123456789012345678901234";
  const views = new Map<string, ReturnType<typeof projectMachineVideoTask>>();
  const handler = createMachineVideoTaskGetHandler({
    readTask: async (userId, id) => (userId === USER_ID ? views.get(id) ?? null : null),
  });
  try {
    const anonymous = await handler(
      request(`http://localhost/api/machine/video-tasks/${taskId}`),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(anonymous.status, 401);

    const missing = await handler(
      request(`http://localhost/api/machine/video-tasks/${taskId}`, { token: TOKEN }),
      { params: Promise.resolve({ id: taskId }) },
    );
    assert.equal(missing.status, 404);

    const base = {
      taskId,
      viewerUserId: USER_ID,
      storyboard: null,
      brief: null,
      finalVideo: null,
      jobs: [],
    };
    views.set(taskId, projectMachineVideoTask(base));
    const waiting = await handler(
      request(`http://localhost/api/machine/video-tasks/${taskId}`, { token: TOKEN }),
      { params: Promise.resolve({ id: taskId }) },
    );
    const waitingBody = await waiting.json();
    assert.equal(waitingBody.status, "awaiting_confirmation");
    assert.equal(waitingBody.deliverableUrl, null);
    assert.equal(waitingBody.started, false);

    const framesReady = projectMachineVideoTask({
      ...base,
      storyboard: { status: "AWAITING_APPROVAL", frameStatuses: ["SUCCEEDED", "SUCCEEDED"] },
    });
    assert.equal(framesReady.status, "awaiting_confirmation");
    assert.equal(framesReady.stage, "storyboard_ready");
    assert.equal(framesReady.deliverableUrl, null);

    const running = projectMachineVideoTask({
      ...base,
      brief: {
        id: "brief_1",
        ownerUserId: USER_ID,
        status: "RENDERING",
        brandedVideoUrl: null,
        brandedAt: null,
        takedownAt: null,
      },
      jobs: [{ status: "RUNNING", submissionState: "ACCEPTED", outputVideoUrl: null }],
    });
    assert.equal(running.status, "running");
    assert.equal(running.started, true);
    assert.equal(running.briefId, "brief_1");
    assert.equal(running.deliverableUrl, null);

    const rawOnly = projectMachineVideoTask({
      ...base,
      brief: {
        id: "brief_1",
        ownerUserId: USER_ID,
        status: "RENDER_SUCCEEDED",
        brandedVideoUrl: null,
        brandedAt: null,
        takedownAt: null,
        finalVideoUrl: "https://cdn.example/raw.mp4",
      },
      jobs: [{
        status: "SUCCEEDED",
        submissionState: "ACCEPTED",
        outputVideoUrl: "https://provider.example/secret-task.mp4",
        errorMessage: "provider task ark-task-should-not-leak",
      }],
    });
    assert.equal(rawOnly.status, "processing_output");
    assert.equal(rawOnly.deliverableUrl, null);
    assert.doesNotMatch(JSON.stringify(rawOnly), /provider|ark-task|secret-task/);

    const failed = projectMachineVideoTask({
      ...base,
      brief: {
        id: "brief_1",
        ownerUserId: USER_ID,
        status: "RENDER_FAILED",
        brandedVideoUrl: null,
        brandedAt: null,
        takedownAt: null,
      },
      jobs: [{
        status: "FAILED",
        submissionState: "REJECTED",
        userSafeError: "视频生成失败，请稍后重试。",
        errorMessage: "SEEDANCE_API_KEY leaked in provider body",
      }],
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.failure?.retryable, true);
    assert.doesNotMatch(JSON.stringify(failed), /SEEDANCE_API_KEY|leaked/);

    const unknown = projectMachineVideoTask({
      ...base,
      brief: {
        id: "brief_1",
        ownerUserId: USER_ID,
        status: "RENDER_FAILED",
        brandedVideoUrl: null,
        brandedAt: null,
        takedownAt: null,
      },
      jobs: [{ status: "FAILED", submissionState: "ACK_UNKNOWN", errorMessage: "timeout after accept" }],
    });
    assert.equal(unknown.status, "failed");
    assert.equal(unknown.stage, "video_ack_unknown");
    assert.equal(unknown.failure?.code, "SUBMISSION_ACK_UNKNOWN");
    assert.equal(unknown.failure?.retryable, false);
    assert.equal(unknown.deliverableUrl, null);

    const foreign = projectMachineVideoTask({
      ...base,
      brief: {
        id: "brief_other",
        ownerUserId: "other_user",
        status: "RENDER_SUCCEEDED",
        brandedVideoUrl: "https://cdn.example/branded.mp4",
        brandedAt: new Date(),
        takedownAt: null,
      },
      jobs: [{ status: "SUCCEEDED", outputVideoUrl: "https://cdn.example/raw.mp4" }],
    });
    assert.notEqual(foreign.status, "deliverable");
    assert.equal(foreign.deliverableUrl, null);
    assert.equal(foreign.briefId, null);

    const takenDown = projectMachineVideoTask({
      ...base,
      brief: {
        id: "brief_1",
        ownerUserId: USER_ID,
        status: "RENDER_SUCCEEDED",
        brandedVideoUrl: "https://cdn.example/branded.mp4",
        brandedAt: new Date(),
        takedownAt: new Date(),
      },
      jobs: [{ status: "SUCCEEDED" }],
    });
    assert.equal(takenDown.status, "cancelled");
    assert.equal(takenDown.deliverableUrl, null);

    const unsafeDespiteUrl = projectMachineVideoTask({
      ...base,
      brief: {
        id: "brief_1",
        ownerUserId: USER_ID,
        status: "RENDER_SUCCEEDED",
        brandedVideoUrl: "https://cdn.example/branded.mp4",
        brandedAt: new Date(),
        takedownAt: null,
      },
      jobs: [{ status: "FAILED", submissionState: "ACK_UNKNOWN" }],
    });
    assert.equal(unsafeDespiteUrl.status, "failed");
    assert.equal(unsafeDespiteUrl.failure?.retryable, false);
    assert.equal(unsafeDespiteUrl.deliverableUrl, null);

    const ready = projectMachineVideoTask({
      ...base,
      brief: {
        id: "brief_1",
        ownerUserId: USER_ID,
        status: "RENDER_SUCCEEDED",
        brandedVideoUrl: "https://cdn.example/branded.mp4",
        brandedAt: new Date().toISOString(),
        takedownAt: null,
      },
      jobs: [{ status: "SUCCEEDED", outputVideoUrl: "https://cdn.example/raw.mp4" }],
    });
    assert.equal(ready.status, "deliverable");
    assert.equal(ready.deliverableUrl, "https://cdn.example/branded.mp4");
    assert.doesNotMatch(JSON.stringify(ready), /raw\.mp4/);
  } finally {
    restore();
  }
});

test("机器视频路由不引用视频供应商客户端，定时任务密钥只用于拒绝混用", () => {
  const files = [
    "src/app/api/machine/video-tasks/route.ts",
    "src/app/api/machine/video-tasks/[id]/route.ts",
    "src/lib/services/machine-video-task-service.ts",
    "src/lib/services/machine-video-task-status.ts",
  ];
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /CRON_SECRET|providers\/seedance|providers\/shuyu|dispatchVideoForBrief|createStoryboardRun/);
  const auth = readFileSync("src/lib/machine-video-auth.ts", "utf8");
  assert.match(auth, /MACHINE_VIDEO_API_TOKEN/);
  assert.match(auth, /token === cronSecret/);
  assert.match(readFileSync("src/middleware.ts", "utf8"), /\/api\/machine\/video-tasks/);
});
