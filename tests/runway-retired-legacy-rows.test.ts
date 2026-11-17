import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import { SegmentRedoRejectedError } from "../src/lib/video-generation/segment-redo";
import {
  __test__ as storyboardServiceTest,
  canRegenerateStoryboardFrame,
  isRetiredStoryboardFramePlan,
  STORYBOARD_RETIRED_PROVIDER_FRAME_CODE,
  STORYBOARD_RETIRED_PROVIDER_FRAME_MESSAGE,
} from "../src/lib/video-generation/storyboard-service";
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
 * 2026-11-16 Runway 出片与出图的代码整段删除之后，库里还留着当初走 Runway 的旧记录
 * （brief / 段任务 / 批次上的线路快照 = runway，故事板帧的 planId = "runway:gpt_image_2"）。这里守住它们的下场：
 *
 *   读         —— 旧快照照常读得出来（线路定义只读保留），不抛；
 *   只重新合成 —— 不调供应商，照常可用；
 *   重做一段 / 重试失败的段 —— 明确拒绝（409 INVALID_STATE，指到「用同样的素材再做一条」），在补扣额度与供应商调用之前；
 *   供应商工厂 —— 遇到 runway 快照直接拒绝，不落到别的适配器分支；
 *   新请求点名 runway —— 按原有的线路选择错误拒绝；
 *   故事板帧 —— runway 的 planId 不当 Shuyu 套餐交出去，任务号不拿去问 Shuyu；这一帧落成失败、可重做。
 *
 * 数据库、会话、供应商全部打桩：零网络、零库。
 */

const require = createRequire(import.meta.url);
const nextAuthRuntime = require("next-auth/next") as Record<string, unknown>;

/// 旧记录上的两种线路快照：Runway 上线后用的 Kling，以及最早几天的 Seedance
const RUNWAY_KLING = {
  videoRouteSnapshot: "runway",
  videoModelSnapshot: "klingO3_pro",
  videoProviderAdapterSnapshot: "runway",
} as const;
const RUNWAY_SEEDANCE = { ...RUNWAY_KLING, videoModelSnapshot: "seedance2" } as const;

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
    throw new Error(`旧 Runway 记录不该走到这里：${what}`);
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
// 读：旧 brief / 段任务 / 批次上的 runway 快照
// ---------------------------------------------------------------------------

test("读旧记录：runway 快照（两种模型）照常读出来，状态是 persisted、线路定义已停用；问可用性恒不可用，不发请求", async () => {
  for (const snapshot of [RUNWAY_KLING, RUNWAY_SEEDANCE]) {
    const read = readVideoRouteSnapshot(snapshot);
    assert.equal(read.state, "persisted");
    assert.equal(read.videoRouteSnapshot, "runway");
    assert.equal(read.videoModelSnapshot, snapshot.videoModelSnapshot, "模型按当时记的原样保留");
    assert.equal(read.route?.enabled, false);
  }
  const availability = await getVideoRouteSnapshotRuntimeAvailability({
    snapshot: RUNWAY_KLING as VideoRouteSnapshot,
    env: { RUNWAYML_API_SECRET: "leftover-key" },
    fetchImpl: (async () => {
      throw new Error("已下线的线路不该发任何请求");
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(availability, { available: false, funded: null, reason: "not_configured" });
});

test("建新快照：runway 一律抛；其余线路不受影响", () => {
  assert.throws(() => createVideoRouteSnapshot("runway"), /Video route runway is retired/);
  assert.equal(createVideoRouteSnapshot("buddy").videoProviderAdapterSnapshot, "shuyu");
});

// ---------------------------------------------------------------------------
// 新请求点名 runway；供应商工厂
// ---------------------------------------------------------------------------

test("新请求点名 runway：客户按 FORBIDDEN、内部按 INVALID_ROUTE 拒绝（原有的选择错误类型），残留的环境变量打不开它", () => {
  /// 真实引擎（不是 mock 演练）：VIDEO_ENGINE_MOCK=false
  const real = { VIDEO_PROVIDER: "byteplus", VIDEO_ENGINE_MOCK: "false", SHUYU_API_KEY: "shuyu-key" };
  const leftovers = {
    ...real,
    RUNWAYML_API_SECRET: "leftover-key",
    VIDEO_CUSTOMER_ROUTE: "runway",
    RUNWAY_PREMIUM: "on",
    RUNWAY_PILOT_ACCOUNTS: "owner@shop.test",
    SHUYU_FALLBACK_TO_RUNWAY: "on",
  };
  for (const env of [real, leftovers]) {
    assert.deepEqual(selectCustomerVideoRouteSnapshot({ env }), createVideoRouteSnapshot("buddy"), "不点名 = Shuyu");
    assert.deepEqual(selectCustomerVideoRouteSnapshot({ env, requestedRouteId: "buddy" }), createVideoRouteSnapshot("buddy"));
    assert.throws(
      () => selectCustomerVideoRouteSnapshot({ env, requestedRouteId: "runway" }),
      (error: unknown) => error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
    );
    assert.throws(
      () => selectVideoRouteSnapshot({ env, isInternalStaff: false, requestedRouteId: "runway" }),
      (error: unknown) => error instanceof VideoRouteSelectionError && error.code === "FORBIDDEN",
    );
    assert.throws(
      () => selectVideoRouteSnapshot({ env, isInternalStaff: true, requestedRouteId: "runway" }),
      (error: unknown) => error instanceof VideoRouteSelectionError && error.code === "INVALID_ROUTE",
    );
  }
});

test("供应商工厂：runway 快照（线路 id 或适配器名任一个是它）明确拒绝，不落到别的适配器分支", () => {
  for (const snapshot of [
    RUNWAY_KLING,
    RUNWAY_SEEDANCE,
    /// 残缺 / 被改过的旧行：线路 id 是别的、适配器名还是 runway
    { videoRouteSnapshot: "byteplus_international", videoModelSnapshot: "klingO3_pro", videoProviderAdapterSnapshot: "runway" },
  ]) {
    assert.throws(
      () => createVideoProviderByRouteSnapshot(snapshot as VideoRouteSnapshot),
      (error: unknown) => error instanceof RetiredVideoRouteError && /已下线/u.test(error.message),
      JSON.stringify(snapshot),
    );
  }
  assert.equal(createVideoProviderByRouteSnapshot(createVideoRouteSnapshot("buddy")).id, "shuyu");
});

// ---------------------------------------------------------------------------
// 重做一段 / 重试失败的段
// ---------------------------------------------------------------------------

test("判据：只拦已下线线路的记录；Shuyu、mock 与没有快照的历史行都不拦", () => {
  for (const snapshot of [RUNWAY_KLING, RUNWAY_SEEDANCE, { videoRouteSnapshot: "buddy", videoProviderAdapterSnapshot: "runway" }]) {
    assert.throws(
      () => assertVideoRouteNotRetiredForRegeneration(snapshot),
      (error: unknown) =>
        error instanceof SegmentRedoRejectedError &&
        error.code === "INVALID_STATE" &&
        error.message === RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE,
    );
  }
  assert.match(RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE, /用同样的素材再做一条/u);
  /// 两条直连线路 2026-11-17 也下线了，它们的旧记录同样被拦：见 direct-seedance-retired-legacy-rows.test.ts
  for (const routeId of ["buddy", "mock"] as const) {
    assert.doesNotThrow(() => assertVideoRouteNotRetiredForRegeneration(createVideoRouteSnapshot(routeId)), routeId);
  }
  assert.doesNotThrow(() => assertVideoRouteNotRetiredForRegeneration({ videoRouteSnapshot: null, videoProviderAdapterSnapshot: null }));
  assert.doesNotThrow(() => assertVideoRouteNotRetiredForRegeneration({}));
});

function runwayBrief() {
  return {
    id: "brief-1",
    persona: "PERSONAL",
    aspectRatio: "9:16",
    finalVideoId: "fv-1",
    directorPlan: { segmentPlan: [] },
    videoGenerationPlan: null,
    referenceImageUrls: [],
    contentAngle: { round: { deliveryOrder: { createdById: "customer-1" } } },
    ...RUNWAY_KLING,
  };
}

function failedRunwayJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    videoBriefId: "brief-1",
    batchJobId: null,
    status: VideoJobStatus.FAILED,
    submissionState: "ACCEPTED",
    submissionErrorClass: null,
    submitAttempts: 1,
    externalJobId: "rw-task-1",
    errorMessage: "[provider:failed] INTERNAL.BAD_OUTPUT",
    lastProviderStatus: "FAILED",
    segmentIndex: 0,
    segmentDurationSec: 15,
    finalVideoId: "fv-1",
    replacesJobId: null,
    supersededAt: null,
    promptText: null,
    createdAt: new Date("2026-11-10T08:00:00.000Z"),
    videoBrief: runwayBrief(),
    ...RUNWAY_KLING,
    ...overrides,
  };
}

test("重做一段（服务）：旧 Runway 成片 → SegmentRedoRejectedError(INVALID_STATE)，不碰成片、不建行、不问供应商", async (t) => {
  const touched = forbidSpendAndProviderCalls(t);
  patchModel(t, db.videoBrief, { findUnique: async () => runwayBrief() });
  patchModel(t, db.finalVideo, {
    findUnique: async () => {
      touched.push("finalVideo.findUnique");
      throw new Error("拒绝应当发生在读成片之前");
    },
  });
  await assert.rejects(
    () => prepareSegmentRedo("brief-1", 0, { promptOverride: "这一段别出现文字" }),
    (error: unknown) =>
      error instanceof SegmentRedoRejectedError &&
      error.code === "INVALID_STATE" &&
      error.message === RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE,
  );
  assert.deepEqual(touched, []);
});

test("重试失败的段（服务）：旧 Runway 段 → SegmentRedoRejectedError(INVALID_STATE)，不查供应商状态、不重提", async (t) => {
  const touched = forbidSpendAndProviderCalls(t);
  patchModel(t, db.videoJob, { findUnique: async () => failedRunwayJob() });
  await assert.rejects(
    () => retryFailedVideoJob("job-1"),
    (error: unknown) =>
      error instanceof SegmentRedoRejectedError &&
      error.code === "INVALID_STATE" &&
      error.message === RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE,
  );
  assert.deepEqual(touched, []);
});

const SESSION = {
  user: { id: "customer-1", email: "owner@shop.test", role: "CUSTOMER", userType: "PERSONAL" },
  expires: "2099-01-01T00:00:00.000Z",
};

function signInOwner(t: TestContext) {
  authTest.resetAccountStatusCache();
  t.after(() => authTest.resetAccountStatusCache());
  patchModel(t, nextAuthRuntime, { getServerSession: async () => structuredClone(SESSION) });
  patchModel(t, db.adminUser, {
    findUnique: async () => ({ role: "CUSTOMER", userType: "PERSONAL", disabledAt: null, email: SESSION.user.email }),
  });
  patchModel(t, db.videoBrief, { findUnique: async () => runwayBrief() });
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

test("render-retry 路由：旧 Runway 视频的 redoSegment / all / jobId 都回 409 INVALID_STATE 和那句指路的话，一分不扣、不是 500", async (t) => {
  /// 开着计量：证明拒绝发生在补扣之前（补扣要进事务，事务一碰就记账）
  withEnv(t, { QUOTA_ENFORCE: "true" });
  signInOwner(t);
  const touched = forbidSpendAndProviderCalls(t);
  patchModel(t, db.videoJob, {
    findMany: async () => [failedRunwayJob()],
    findUnique: async () => failedRunwayJob(),
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

test("render-retry 路由：重做候选行（失败的那条）当初走 Runway，all / jobId 同样在候选行补扣之前拒绝", async (t) => {
  withEnv(t, { QUOTA_ENFORCE: "true" });
  signInOwner(t);
  const touched = forbidSpendAndProviderCalls(t);
  const candidate = failedRunwayJob({ id: "job-redo", finalVideoId: null, replacesJobId: "job-0" });
  patchModel(t, db.videoJob, { findMany: async () => [candidate], findUnique: async () => candidate });
  for (const body of [{ all: true }, { jobId: "job-redo" }]) {
    const response = await retryRequest(body);
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(((await response.json()) as { error: string }).error, RETIRED_VIDEO_ROUTE_REGENERATION_MESSAGE);
  }
  assert.deepEqual(touched, []);
});

// ---------------------------------------------------------------------------
// 只重新合成：不调供应商，旧 Runway 成片照常可用
// ---------------------------------------------------------------------------

const BASE_PLAN: PostProductionPlan = {
  audio: {
    voiceover: { enabled: true, voiceId: "warm-confident", language: "zh", script: "这条毛毯一抖就蓬起来。" },
    bgm: { trackId: "none", volume: 0 },
  },
  captions: { enabled: true, style: "plain", language: "zh", position: "bottom", exportSrt: true },
};

test("只重新合成：段全是 Runway 出的旧成片照常 READY→PENDING 进重拼，不建段任务、不问供应商", async (t) => {
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
      brief: { id: "brief-1", status: VideoBriefStatus.QA_PENDING, ...RUNWAY_KLING },
      /// 段的成片地址是当初转存进自己存储的那一份
      segments: [0, 1].map((segmentIndex) => ({
        segmentIndex,
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: `https://abc.public.blob.vercel-storage.com/renders/provider-outputs/runway/rw-task-${segmentIndex}.mp4`,
        outputThumbUrl: null,
        assignedAssets: null,
        ...RUNWAY_KLING,
      })),
    }),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      writes.push(args);
      if (typeof args.data.status === "string") status = args.data.status as FinalVideoStatus;
      return { count: 1 };
    },
  });
  patchModel(t, db.videoBrief, { findUnique: async () => ({ videoGenerationPlan: null, ...RUNWAY_KLING }) });

  const result = await restitchReadyFinalVideo("fv-1", { bgm: { trackId: "wholesome", volume: 0.2 } });

  assert.equal(writes[0]?.data.status, FinalVideoStatus.PENDING);
  assert.equal(writes[0]?.data.previousStitchedVideoUrl, OLD_URL, "旧片留作回滚依据");
  assert.equal(result.awaitingExternal, true);
  assert.deepEqual(touched, []);

  /// 合成这一层从头到尾不认线路：没有线路登记表、没有供应商工厂
  const stitchService = await readFile("src/lib/services/stitch-service.ts", "utf8");
  assert.doesNotMatch(stitchService, /video-route-registry|readVideoRouteSnapshot|createVideoProviderByRouteSnapshot|providers\/index/);
});

// ---------------------------------------------------------------------------
// 故事板帧：planId = "runway:gpt_image_2" 的旧帧
// ---------------------------------------------------------------------------

type FrameWrite = { where: Record<string, unknown>; data: Record<string, unknown> };

function stubFrameModel(t: TestContext) {
  const model = db.storyboardFrame as unknown as Record<string, unknown>;
  const originals = { findUnique: model.findUnique, findFirst: model.findFirst, updateMany: model.updateMany };
  t.after(() => {
    Object.assign(model, originals);
    storyboardServiceTest.__setRuntimeDependenciesForTests(null);
  });
  return model;
}

function frameRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "frame-1",
    ordinal: 1,
    attempt: 1,
    isCurrent: true,
    status: "QUEUED",
    submissionState: "NOT_STARTED",
    providerRequestKey: "req-key-1",
    prompt: "Create ONE photorealistic commercial storyboard keyframe.",
    inputImageUrls: ["https://blob.example/blanket.png"],
    planId: null,
    modelSnapshot: null,
    resolutionSnapshot: null,
    pointsSnapshot: null,
    externalTaskId: null,
    outputAsset: null,
    storyboardRunId: "run-1",
    storyboardRun: {
      id: "run-1",
      userId: "owner-1",
      status: "GENERATING",
      aspectRatio: "9:16",
      inputImageUrls: ["https://blob.example/blanket.png"],
      frames: [],
    },
    ...overrides,
  };
}

const RUNWAY_FRAME_PLAN = {
  planId: "runway:gpt_image_2",
  modelSnapshot: "gpt_image_2",
  resolutionSnapshot: "2K",
  pointsSnapshot: 0,
};

test("旧帧判据：runway: 开头的 planId 才算；Shuyu 套餐号、空值都不算", () => {
  assert.equal(isRetiredStoryboardFramePlan("runway:gpt_image_2"), true);
  assert.equal(isRetiredStoryboardFramePlan("runway:anything-else"), true);
  for (const planId of ["image-plan-01", "video-plan-113", "", null, undefined]) {
    assert.equal(isRetiredStoryboardFramePlan(planId), false, String(planId));
  }
});

test("排队中的旧 Runway 帧：不交给 Shuyu（不当套餐快照、不提交），这一帧落成失败并提示重新生成", async (t) => {
  const model = stubFrameModel(t);
  const writes: FrameWrite[] = [];
  model.findUnique = async () => frameRow(RUNWAY_FRAME_PLAN);
  model.updateMany = async (args: FrameWrite) => {
    writes.push(args);
    return { count: 1 };
  };
  let shuyuCalls = 0;
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    submitTask: (async () => {
      shuyuCalls += 1;
      throw new Error("旧 Runway 帧不该提交给 Shuyu");
    }) as never,
  });

  await storyboardServiceTest.submitStoryboardFrame("frame-1");

  assert.equal(shuyuCalls, 0);
  assert.equal(writes.length, 1, "只有把这一帧落成失败的那一次写入，没有认领、没有提交");
  assert.deepEqual(writes[0].where, { id: "frame-1", isCurrent: true, status: "QUEUED", submissionState: "NOT_STARTED" });
  assert.equal(writes[0].data.status, "FAILED");
  assert.equal(writes[0].data.submissionState, "REJECTED");
  assert.equal(writes[0].data.errorCode, STORYBOARD_RETIRED_PROVIDER_FRAME_CODE);
  assert.equal(writes[0].data.errorMessage, STORYBOARD_RETIRED_PROVIDER_FRAME_MESSAGE);
  assert.match(STORYBOARD_RETIRED_PROVIDER_FRAME_MESSAGE, /重新生成这一帧/u);
});

test("在途的旧 Runway 帧：不拿 Runway 的任务号去问 Shuyu，这一帧落成失败并提示重新生成", async (t) => {
  const model = stubFrameModel(t);
  const writes: FrameWrite[] = [];
  model.updateMany = async (args: FrameWrite) => {
    writes.push(args);
    return { count: 1 };
  };
  model.findFirst = async () =>
    frameRow({ ...RUNWAY_FRAME_PLAN, status: "PROCESSING", submissionState: "ACCEPTED", externalTaskId: "rw-task-9" });
  let shuyuPolls = 0;
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    pollTask: (async () => {
      shuyuPolls += 1;
      throw new Error("Runway 的任务号不该拿去问 Shuyu");
    }) as never,
    fetchOutput: (async () => {
      throw new Error("不该取图");
    }) as never,
  });

  await storyboardServiceTest.reconcileStoryboardFrame("frame-1");

  assert.equal(shuyuPolls, 0);
  const failed = writes.find((write) => write.data.status === "FAILED");
  assert.ok(failed, "这一帧落成失败");
  assert.equal(failed.data.errorCode, STORYBOARD_RETIRED_PROVIDER_FRAME_CODE);
  assert.equal(failed.data.errorMessage, STORYBOARD_RETIRED_PROVIDER_FRAME_MESSAGE);
  assert.equal(failed.data.leaseOwner, null, "租约放掉");
  assert.equal(writes.some((write) => "pollErrors" in write.data && write !== writes[0]), false, "不按轮询异常记、不排下一次轮询");
});

test("旧 Runway 的失败帧一律可重做（包括带任务号的确认未知）；Shuyu 帧的重做判据不变", () => {
  const failed = { status: "FAILED", lastProviderStatus: "FAILED" };
  /// 重做会建一条不带 planId 的新帧，走 Shuyu
  assert.equal(canRegenerateStoryboardFrame({ ...failed, submissionState: "ACCEPTED", externalTaskId: "rw-1", planId: "runway:gpt_image_2" }), true);
  assert.equal(canRegenerateStoryboardFrame({ ...failed, submissionState: "ACK_UNKNOWN", externalTaskId: "rw-1", planId: "runway:gpt_image_2" }), true);
  assert.equal(canRegenerateStoryboardFrame({ ...failed, submissionState: "REJECTED", externalTaskId: null, planId: "runway:gpt_image_2" }), true);
  /// 还在跑的不算
  assert.equal(
    canRegenerateStoryboardFrame({ status: "PROCESSING", submissionState: "ACCEPTED", externalTaskId: "rw-1", planId: "runway:gpt_image_2" }),
    false,
  );
  /// Shuyu 帧：任务号已知的确认未知要等核对；失败但没确认退款的不能重做；确认退款的可以
  assert.equal(canRegenerateStoryboardFrame({ ...failed, submissionState: "ACK_UNKNOWN", externalTaskId: "sy-1", planId: "image-plan-01" }), false);
  assert.equal(canRegenerateStoryboardFrame({ ...failed, submissionState: "ACCEPTED", externalTaskId: "sy-1", planId: "image-plan-01" }), false);
  assert.equal(
    canRegenerateStoryboardFrame({ status: "FAILED", lastProviderStatus: "refunded", submissionState: "ACCEPTED", externalTaskId: "sy-1", planId: "image-plan-01" }),
    true,
  );
  assert.equal(canRegenerateStoryboardFrame({ ...failed, submissionState: "ACK_UNKNOWN", externalTaskId: "sy-1" }), false, "不带 planId 的调用方（批量）行为不变");
});

test("Shuyu 帧不受影响：记过 Shuyu 套餐的帧照旧带着套餐快照提交给 Shuyu；没选过套餐的新帧也只走 Shuyu", async (t) => {
  const model = stubFrameModel(t);
  model.updateMany = async () => ({ count: 1 });
  const submitted: Array<{ planSnapshot?: { planId: string } }> = [];
  storyboardServiceTest.__setRuntimeDependenciesForTests({
    submitTask: (async (input: { planSnapshot?: { planId: string } }) => {
      submitted.push(input);
      return { externalTaskId: `sy-task-${submitted.length}` };
    }) as never,
  });

  model.findUnique = async () =>
    frameRow({ planId: "image-plan-01", modelSnapshot: "gpt-image-2", resolutionSnapshot: "2K", pointsSnapshot: 40 });
  await storyboardServiceTest.submitStoryboardFrame("frame-1");
  model.findUnique = async () => frameRow();
  await storyboardServiceTest.submitStoryboardFrame("frame-1");

  assert.equal(submitted.length, 2);
  assert.equal(submitted[0].planSnapshot?.planId, "image-plan-01", "重试沿用首次选定的 Shuyu 套餐");
  assert.equal(submitted[1].planSnapshot, undefined, "新帧由 Shuyu 侧现选套餐");
});
