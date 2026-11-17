import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { __test__ as authTest } from "../src/lib/auth";
import { POST as renderRetry } from "../src/app/api/briefs/[id]/render-retry/route";
import { restitchReadyFinalVideo } from "../src/lib/services/stitch-service";
import {
  __test__ as videoServiceTest,
  assertVideoRouteNotRetiredForRegeneration,
  prepareSegmentRedo,
  retryFailedVideoJob,
  RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE,
} from "../src/lib/services/video-service";
import {
  createVideoProviderByRouteSnapshot,
  RetiredVideoRouteError,
} from "../src/lib/video-generation/providers";
import { batchCreateRequestSchema } from "../src/lib/contracts/batch-request";
import { SegmentRedoRejectedError } from "../src/lib/video-generation/segment-redo";
import {
  createVideoRouteSnapshot,
  readVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "../src/lib/video-generation/video-route-registry";
import {
  getVideoRouteSnapshotRuntimeAvailability,
  selectCustomerVideoRouteSnapshot,
  selectVideoRouteSnapshot,
  VideoRouteSelectionError,
} from "../src/lib/video-generation/video-route-selection";
import type { PostProductionPlan } from "../src/types/video-generation";

/**
 * 2026-11-17 两条直连 Seedance 线路（BytePlus ModelArk 国际 byteplus_international、火山 Ark 北京 volcengine_cn_legacy，
 * 共用适配器名 byteplus）的出片代码整段删除之后，库里还留着当初走它们的旧记录（brief / 段任务 / 批次上的线路快照）。
 * 与 runway-retired-legacy-rows.test.ts 同一套保证：
 *
 *   读         —— 旧快照照常读得出来（线路定义只读保留），不抛；
 *   只重新合成 —— 不调供应商，照常可用；
 *   重做一段 / 重试失败的段 —— 明确拒绝（409 INVALID_STATE，指到「用同样的素材再做一条」），在补扣额度与供应商调用之前；
 *   供应商工厂 —— 遇到这两条线路的快照直接拒绝，不落到 Shuyu 适配器上；
 *   新请求点名它们 —— 按原有的线路选择错误拒绝，残留的密钥与环境变量打不开。
 *
 * 数据库、会话、供应商全部打桩：零网络、零库。
 */

const require = createRequire(import.meta.url);
const nextAuthRuntime = require("next-auth/next") as Record<string, unknown>;

/// 旧记录上的两种线路快照：国际站与北京站，适配器名都是 byteplus
const BYTEPLUS_INTL = {
  videoRouteSnapshot: "byteplus_international",
  videoModelSnapshot: "dreamina-seedance-2-0-260128",
  videoProviderAdapterSnapshot: "byteplus",
} as const;
const VOLCENGINE_CN = {
  videoRouteSnapshot: "volcengine_cn_legacy",
  videoModelSnapshot: "doubao-seedance-2-0-260128",
  videoProviderAdapterSnapshot: "byteplus",
} as const;
const DIRECT_SNAPSHOTS = [BYTEPLUS_INTL, VOLCENGINE_CN] as const;
type DirectSnapshot = (typeof DIRECT_SNAPSHOTS)[number];
/// 线上残留的直连配置：密钥、端点、运行时档位都还在也打不开这两条线路
const DIRECT_LEFTOVERS = {
  BYTEPLUS_ARK_API_KEY: "leftover-international-key",
  ARK_API_KEY: "leftover-legacy-key",
  ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
  SEEDANCE_RUNTIME_PROFILE: "volcengine_cn_legacy",
  ARK_VIDEO_I2V_MODEL: "doubao-seedance-2-0-pro",
};

function patchModel(t: TestContext, model: object, patches: Record<string, unknown>) {
  const record = model as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = record[key];
    record[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) record[key] = originals[key];
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

/// 任何「花钱」或「问供应商」的动作被碰到就记一笔：拒绝必须发生在它们之前
function forbidSpendAndProviderCalls(t: TestContext): string[] {
  const touched: string[] = [];
  const boom = (what: string) => async () => {
    touched.push(what);
    throw new Error(`旧直连线路记录不该走到这里：${what}`);
  };
  patchModel(t, db.videoJob, {
    create: boom("videoJob.create"),
    update: boom("videoJob.update"),
    updateMany: boom("videoJob.updateMany"),
    count: boom("videoJob.count"),
  });
  /// 补扣额度、建候选行都在事务里
  patchModel(t, db as unknown as object, { $transaction: boom("db.$transaction") });
  videoServiceTest.__setStatusFetcherForTests(boom("provider.getVideoJobStatus") as never);
  videoServiceTest.__setSubmitterForTests(boom("provider.createVideoJob") as never);
  t.after(() => {
    videoServiceTest.__setStatusFetcherForTests(null);
    videoServiceTest.__setSubmitterForTests(null);
  });
  return touched;
}

// ---------------------------------------------------------------------------
// 读：旧 brief / 段任务 / 批次上的直连线路快照
// ---------------------------------------------------------------------------

test("读旧记录：两条直连线路的快照（含当时用环境变量换过的模型）照常读出来，线路定义已停用；问可用性恒不可用，不发请求", async () => {
  for (const snapshot of [...DIRECT_SNAPSHOTS, { ...VOLCENGINE_CN, videoModelSnapshot: "doubao-seedance-2-0-pro" }]) {
    const read = readVideoRouteSnapshot(snapshot);
    assert.equal(read.state, "persisted");
    assert.equal(read.videoRouteSnapshot, snapshot.videoRouteSnapshot);
    assert.equal(read.videoModelSnapshot, snapshot.videoModelSnapshot, "模型按当时记的原样保留");
    assert.equal(read.videoProviderAdapterSnapshot, "byteplus");
    assert.equal(read.route?.enabled, false);
  }
  for (const snapshot of DIRECT_SNAPSHOTS) {
    const availability = await getVideoRouteSnapshotRuntimeAvailability({
      snapshot: snapshot as VideoRouteSnapshot,
      env: DIRECT_LEFTOVERS,
      fetchImpl: (async () => {
        throw new Error("已下线的线路不该发任何请求");
      }) as unknown as typeof fetch,
    });
    assert.deepEqual(availability, { available: false, funded: null, reason: "not_configured" }, snapshot.videoRouteSnapshot);
  }
});

test("建新快照：两条直连线路一律抛；Shuyu 不受影响", () => {
  for (const snapshot of DIRECT_SNAPSHOTS) {
    assert.throws(
      () => createVideoRouteSnapshot(snapshot.videoRouteSnapshot),
      new RegExp(`Video route ${snapshot.videoRouteSnapshot} is retired`),
    );
  }
  assert.equal(createVideoRouteSnapshot("buddy").videoProviderAdapterSnapshot, "shuyu");
});

// ---------------------------------------------------------------------------
// 新请求点名直连线路；供应商工厂
// ---------------------------------------------------------------------------

test("新请求点名直连线路：客户按 FORBIDDEN、内部按 INVALID_ROUTE 拒绝；不点名一律是 Shuyu，残留的密钥与档位打不开它们", () => {
  /// 真实引擎（不是 mock 演练）。生产的三种形状：VIDEO_PROVIDER 没写、写 shuyu、残留旧值 byteplus
  for (const provider of [undefined, "shuyu", "byteplus"]) {
    const env = {
      ...(provider ? { VIDEO_PROVIDER: provider } : {}),
      VIDEO_ENGINE_MOCK: "false",
      SHUYU_API_KEY: "shuyu-key",
      ...DIRECT_LEFTOVERS,
    };
    assert.deepEqual(selectCustomerVideoRouteSnapshot({ env }), createVideoRouteSnapshot("buddy"), "客户不点名 = Shuyu");
    assert.deepEqual(
      selectVideoRouteSnapshot({ env, isInternalStaff: true }),
      createVideoRouteSnapshot("buddy"),
      "内部不点名也是 Shuyu：不再有「按运行时档位取直连线路」的缺省",
    );
    for (const { videoRouteSnapshot: routeId } of DIRECT_SNAPSHOTS) {
      assert.throws(
        () => selectCustomerVideoRouteSnapshot({ env, requestedRouteId: routeId }),
        (error: unknown) => error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
        routeId,
      );
      assert.throws(
        () => selectVideoRouteSnapshot({ env, isInternalStaff: false, requestedRouteId: routeId }),
        (error: unknown) => error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
        routeId,
      );
      assert.throws(
        () => selectVideoRouteSnapshot({ env, isInternalStaff: true, requestedRouteId: routeId }),
        (error: unknown) => error instanceof VideoRouteSelectionError && error.code === "INVALID_ROUTE",
        routeId,
      );
    }
  }
});

test("批量建单的请求体：videoRouteId 只收 buddy，点名直连线路在参数校验就被拒（400，不是 500）", () => {
  const base = { templateId: "tpl-1", templateVersion: 1, assetIds: ["asset-1"], requestedCount: 1 };
  assert.equal(batchCreateRequestSchema.safeParse(base).success, true);
  assert.equal(batchCreateRequestSchema.safeParse({ ...base, videoRouteId: "buddy" }).success, true);
  for (const routeId of ["byteplus_international", "volcengine_cn_legacy", "runway", "mock"]) {
    assert.equal(batchCreateRequestSchema.safeParse({ ...base, videoRouteId: routeId }).success, false, routeId);
  }
});

test("供应商工厂：直连线路的快照（线路 id 或适配器名任一个是它）明确拒绝，不落到 Shuyu 适配器上", () => {
  for (const snapshot of [
    ...DIRECT_SNAPSHOTS,
    /// 残缺 / 被改过的旧行：线路 id 是还在用的那条、适配器名还是 byteplus——不能因此交给 Shuyu
    { videoRouteSnapshot: "buddy", videoModelSnapshot: "dreamina-seedance-2-0-260128", videoProviderAdapterSnapshot: "byteplus" },
    { videoRouteSnapshot: "mock", videoModelSnapshot: "x", videoProviderAdapterSnapshot: "byteplus" },
  ]) {
    assert.throws(
      () => createVideoProviderByRouteSnapshot(snapshot as VideoRouteSnapshot),
      (error: unknown) => error instanceof RetiredVideoRouteError && /已下线/u.test(error.message),
      JSON.stringify(snapshot),
    );
  }
  assert.equal(createVideoProviderByRouteSnapshot(createVideoRouteSnapshot("buddy")).id, "shuyu");
});

test("直连线路的代码不在了：客户端、适配器、运行时档位三个文件都删了，src 里没有代码再读它们的密钥与端点", async () => {
  for (const gone of [
    "src/lib/providers/seedance.ts",
    "src/lib/video-generation/providers/byteplus-video-provider.ts",
    "src/lib/config/seedance-runtime.ts",
  ]) {
    assert.equal(existsSync(gone), false, `${gone} 应该已经删除`);
  }
  const offenders: string[] = [];
  const forbidden =
    /providers\/seedance["']|byteplus-video-provider|seedance-runtime|BYTEPLUS_ARK_API_KEY|\bARK_API_KEY\b|ARK_BASE_URL|ARK_VIDEO_(I2V_)?MODEL|SEEDANCE_RUNTIME_PROFILE|ark\.ap-southeast\.bytepluses\.com|ark\.cn-beijing\.volces\.com/;
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
    });
  for (const file of walk("src")) {
    /// 注释里可以提历史；只看代码行
    const code = (await readFile(file, "utf8"))
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    if (forbidden.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// 重做一段 / 重试失败的段
// ---------------------------------------------------------------------------

test("判据：两条直连线路的记录（线路 id 或适配器名任一个命中）都拦；Shuyu、mock 与没有快照的历史行都不拦", () => {
  for (const snapshot of [...DIRECT_SNAPSHOTS, { videoRouteSnapshot: "buddy", videoProviderAdapterSnapshot: "byteplus" }]) {
    assert.throws(
      () => assertVideoRouteNotRetiredForRegeneration(snapshot),
      (error: unknown) =>
        error instanceof SegmentRedoRejectedError &&
        error.code === "INVALID_STATE" &&
        error.message === RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE,
    );
  }
  assert.match(RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE, /用同样的素材再做一条/u);
  for (const routeId of ["buddy", "mock"] as const) {
    assert.doesNotThrow(() => assertVideoRouteNotRetiredForRegeneration(createVideoRouteSnapshot(routeId)), routeId);
  }
  assert.doesNotThrow(() => assertVideoRouteNotRetiredForRegeneration({ videoRouteSnapshot: null, videoProviderAdapterSnapshot: null }));
  assert.doesNotThrow(() => assertVideoRouteNotRetiredForRegeneration({}));
});

function directBrief(snapshot: DirectSnapshot = BYTEPLUS_INTL) {
  return {
    id: "brief-1",
    persona: "PERSONAL",
    aspectRatio: "9:16",
    finalVideoId: "fv-1",
    directorPlan: { segmentPlan: [] },
    videoGenerationPlan: null,
    referenceImageUrls: [],
    contentAngle: { round: { deliveryOrder: { createdById: "customer-1" } } },
    ...snapshot,
  };
}

function failedDirectJob(overrides: Record<string, unknown> = {}, snapshot: DirectSnapshot = BYTEPLUS_INTL) {
  return {
    id: "job-1",
    videoBriefId: "brief-1",
    batchJobId: null,
    status: VideoJobStatus.FAILED,
    submissionState: "ACCEPTED",
    submissionErrorClass: null,
    submitAttempts: 1,
    externalJobId: "cgt-20260720-task-1",
    errorMessage: "[provider:failed] OutputVideoSensitiveContentDetected",
    lastProviderStatus: "FAILED",
    segmentIndex: 0,
    segmentDurationSec: 15,
    finalVideoId: "fv-1",
    replacesJobId: null,
    supersededAt: null,
    promptText: null,
    createdAt: new Date("2026-07-20T08:00:00.000Z"),
    videoBrief: directBrief(snapshot),
    ...snapshot,
    ...overrides,
  };
}

test("重做一段（服务）：旧直连成片（两条线路）→ SegmentRedoRejectedError(INVALID_STATE)，不碰成片、不建行、不问供应商", async (t) => {
  const touched = forbidSpendAndProviderCalls(t);
  let current: DirectSnapshot = BYTEPLUS_INTL;
  patchModel(t, db.videoBrief, { findUnique: async () => directBrief(current) });
  patchModel(t, db.finalVideo, {
    findUnique: async () => {
      touched.push("finalVideo.findUnique");
      throw new Error("拒绝应当发生在读成片之前");
    },
  });
  for (const snapshot of DIRECT_SNAPSHOTS) {
    current = snapshot;
    await assert.rejects(
      () => prepareSegmentRedo("brief-1", 0, { promptOverride: "这一段别出现文字" }),
      (error: unknown) =>
        error instanceof SegmentRedoRejectedError &&
        error.code === "INVALID_STATE" &&
        error.message === RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE,
      snapshot.videoRouteSnapshot,
    );
  }
  assert.deepEqual(touched, []);
});

test("重试失败的段（服务）：旧直连段（两条线路）→ SegmentRedoRejectedError(INVALID_STATE)，不查供应商状态、不重提", async (t) => {
  const touched = forbidSpendAndProviderCalls(t);
  let current: DirectSnapshot = BYTEPLUS_INTL;
  patchModel(t, db.videoJob, { findUnique: async () => failedDirectJob({}, current) });
  for (const snapshot of DIRECT_SNAPSHOTS) {
    current = snapshot;
    await assert.rejects(
      () => retryFailedVideoJob("job-1"),
      (error: unknown) =>
        error instanceof SegmentRedoRejectedError &&
        error.code === "INVALID_STATE" &&
        error.message === RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE,
      snapshot.videoRouteSnapshot,
    );
  }
  assert.deepEqual(touched, []);
});

const SESSION = {
  user: { id: "customer-1", email: "owner@shop.test", role: "CUSTOMER", userType: "PERSONAL" },
  expires: "2099-01-01T00:00:00.000Z",
};

function signInOwner(t: TestContext, snapshot: DirectSnapshot = BYTEPLUS_INTL) {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  patchModel(t, nextAuthRuntime, { getServerSession: async () => structuredClone(SESSION) });
  patchModel(t, db.adminUser, {
    findUnique: async () => ({ role: "CUSTOMER", userType: "PERSONAL", disabledAt: null, email: SESSION.user.email }),
  });
  patchModel(t, db.videoBrief, { findUnique: async () => directBrief(snapshot) });
}

function retryRequest(body: unknown) {
  return renderRetry(
    new NextRequest("http://localhost/api/briefs/brief-1/render-retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "brief-1" }) },
  );
}

for (const snapshot of DIRECT_SNAPSHOTS) test(`render-retry 路由：旧 ${snapshot.videoRouteSnapshot} 视频的 redoSegment / all / jobId 都回 409 INVALID_STATE 和那句指路的话，一分不扣、不是 500`, async (t) => {
  /// 开着计量：证明拒绝发生在补扣之前（补扣要进事务，事务一碰就记账）；残留的直连密钥不改变结论
  withEnv(t, { QUOTA_ENFORCE: "true", ...DIRECT_LEFTOVERS });
  signInOwner(t, snapshot);
  const touched = forbidSpendAndProviderCalls(t);
  patchModel(t, db.videoJob, {
    findMany: async () => [failedDirectJob({}, snapshot)],
    findUnique: async () => failedDirectJob({}, snapshot),
  });
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errors.push(args);
  });

  for (const body of [{ redoSegment: { segmentIndex: 0 } }, { all: true }, { jobId: "job-1" }]) {
    const response = await retryRequest(body);
    const payload = (await response.json()) as { code: string; error: string; retryable: boolean; action: string };
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(payload.code, "INVALID_STATE");
    assert.equal(payload.error, RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE);
    assert.equal(payload.retryable, false);
    assert.equal(payload.action, "refresh_status");
  }
  assert.deepEqual(touched, [], "没有补扣、没有建行、没有供应商调用");
  assert.deepEqual(errors, [], "走的是有类型的拒绝，不是兜底的 500 分支");
});

test("render-retry 路由：重做候选行（失败的那条）当初走直连线路，all / jobId 同样在候选行补扣之前拒绝", async (t) => {
  withEnv(t, { QUOTA_ENFORCE: "true" });
  signInOwner(t);
  const touched = forbidSpendAndProviderCalls(t);
  const candidate = failedDirectJob({ id: "job-redo", finalVideoId: null, replacesJobId: "job-0" });
  patchModel(t, db.videoJob, { findMany: async () => [candidate], findUnique: async () => candidate });
  for (const body of [{ all: true }, { jobId: "job-redo" }]) {
    const response = await retryRequest(body);
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(((await response.json()) as { error: string }).error, RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE);
  }
  assert.deepEqual(touched, []);
});

// ---------------------------------------------------------------------------
// 只重新合成：不调供应商，旧直连成片照常可用
// ---------------------------------------------------------------------------

const BASE_PLAN: PostProductionPlan = {
  audio: {
    voiceover: { enabled: true, voiceId: "warm-confident", language: "zh", script: "这条毛毯一抖就蓬起来。" },
    bgm: { trackId: "none", volume: 0 },
  },
  captions: { enabled: true, style: "plain", language: "zh", position: "bottom", exportSrt: true },
};

for (const snapshot of DIRECT_SNAPSHOTS) test(`只重新合成：段全是 ${snapshot.videoRouteSnapshot} 出的旧成片照常 READY→PENDING 进重拼，不建段任务、不问供应商`, async (t) => {
  withEnv(t, { STITCH_RUNTIME: "external", ENABLE_VIDEO_STITCHING: undefined });
  const touched = forbidSpendAndProviderCalls(t);
  const OLD_URL = "https://abc.public.blob.vercel-storage.com/final-videos/fv-1/old.mp4";
  let status: FinalVideoStatus = FinalVideoStatus.READY;
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo, {
    findUnique: async () => ({
      id: "fv-1",
      status,
      segmentCount: 2,
      targetDurationSec: 15,
      stitchAttempts: 1,
      stitchAttemptToken: null,
      stitchedVideoUrl: OLD_URL,
      previousStitchedVideoUrl: null,
      thumbnailUrl: null,
      subtitleFileUrl: null,
      ffmpegError: null,
      postProduction: BASE_PLAN,
      previousPostProduction: null,
      brief: { id: "brief-1", status: VideoBriefStatus.QA_PENDING, ...snapshot },
      /// 段的成片地址是当初转存进自己存储的那一份
      segments: [0, 1].map((segmentIndex) => ({
        segmentIndex,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: `https://abc.public.blob.vercel-storage.com/renders/provider-outputs/seedance/cgt-task-${segmentIndex}.mp4`,
        outputThumbUrl: null,
        assignedAssets: null,
        ...snapshot,
      })),
    }),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      writes.push(args);
      if (typeof args.data.status === "string") status = args.data.status as FinalVideoStatus;
      return { count: 1 };
    },
  });
  patchModel(t, db.videoBrief, { findUnique: async () => ({ videoGenerationPlan: null, ...snapshot }) });

  const result = await restitchReadyFinalVideo("fv-1", { bgm: { trackId: "wholesome", volume: 0.2 } });

  assert.equal(writes[0]?.data.status, FinalVideoStatus.PENDING);
  assert.equal(writes[0]?.data.previousStitchedVideoUrl, OLD_URL, "旧片留作回滚依据");
  assert.equal(result.awaitingExternal, true);
  assert.deepEqual(touched, []);

  /// 合成这一层从头到尾不认线路：没有线路登记表、没有供应商工厂
  const stitchService = await readFile("src/lib/services/stitch-service.ts", "utf8");
  assert.doesNotMatch(stitchService, /video-route-registry|readVideoRouteSnapshot|createVideoProviderByRouteSnapshot|providers\/index/);
});
