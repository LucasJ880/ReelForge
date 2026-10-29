import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { __testVideoPlans__ } from "../src/lib/providers/shuyu";
import { unifiedVideoGenerationRequestSchema } from "../src/lib/schemas/unified-input";
import {
  __test__ as videoService,
  dispatchVideoForBrief,
  reconcileVideoJob,
} from "../src/lib/services/video-service";
import { WATCHDOG_TIMEOUT_PREFIX } from "../src/lib/services/video-watchdog";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import { mapPlanToDirectorPlan } from "../src/lib/video-generation/plan-to-director";
import { ProviderSubmissionError } from "../src/lib/video-generation/providers/submission-error";
import type { CreateVideoJobOptions } from "../src/lib/video-generation/providers/types";
import {
  directorPlanBeforeGrounding,
  PROVIDER_FAILED_ERROR_PREFIX,
  routeFallbackDecision,
  runwayFallbackDecision,
  type RunwayFallbackJob,
} from "../src/lib/video-generation/runway-fallback";
import {
  groundSegmentPromptForOpeningFrame,
  STORYBOARD_GROUNDING_MARKER,
} from "../src/lib/video-generation/storyboard-beats";
import { createVideoRouteSnapshot } from "../src/lib/video-generation/video-route-registry";
import type { UnifiedVideoGenerationRequest, VideoGenerationPlan } from "../src/types/video-generation";

/**
 * Runway 拒单自动改交 Shuyu（2026-10-28 晚灰度真机：Kling 提交被 400 拒，商家只看到「请联系支持」）。
 * 派发当场被拒、任务受理后被 Runway 判失败，两条路都换到 Shuyu 重新派发；拿不准的一律不换。
 */

const rejectedAtSubmit = (overrides: Partial<RunwayFallbackJob> = {}): RunwayFallbackJob => ({
  status: "FAILED",
  submissionState: "REJECTED",
  submissionErrorClass: "definitely_not_created:provider_response",
  externalJobId: null,
  errorMessage: "[provider:rejected] Runway 400: promptText must be at most 2500 characters",
  lastProviderStatus: null,
  videoProviderAdapterSnapshot: "runway",
  ...overrides,
});

const failedByRunway = (overrides: Partial<RunwayFallbackJob> = {}): RunwayFallbackJob =>
  rejectedAtSubmit({
    submissionState: "ACCEPTED",
    submissionErrorClass: null,
    externalJobId: "rw-task-1",
    errorMessage: `${PROVIDER_FAILED_ERROR_PREFIX} Input image flagged（SAFETY.INPUT.IMAGE）`,
    lastProviderStatus: "FAILED",
    ...overrides,
  });

test("换不换：Runway 一定没收钱、整条视频也没有能用的段才换；拿不准的一律不换", () => {
  assert.deepEqual(runwayFallbackDecision([rejectedAtSubmit()]), { fallback: true, trigger: "submit_rejected" });
  assert.deepEqual(
    runwayFallbackDecision([rejectedAtSubmit({ submissionErrorClass: "definitely_not_created:preflight" })]),
    { fallback: true, trigger: "submit_rejected" },
  );
  assert.deepEqual(runwayFallbackDecision([failedByRunway()]), { fallback: true, trigger: "provider_failed" });
  assert.deepEqual(runwayFallbackDecision([rejectedAtSubmit(), failedByRunway()]), {
    fallback: true,
    trigger: "provider_failed",
  });

  /// 拿不准 Runway 有没有建任务、是不是还在跑：换了可能两家都收钱
  const uncertain = { fallback: false, reason: "uncertain" };
  assert.deepEqual(
    runwayFallbackDecision([
      rejectedAtSubmit({ submissionState: "ACK_UNKNOWN", submissionErrorClass: "acknowledgement_unknown:transport" }),
    ]),
    uncertain,
  );
  assert.deepEqual(
    runwayFallbackDecision([
      failedByRunway({ errorMessage: `${WATCHDOG_TIMEOUT_PREFIX} 超过全局 deadline`, lastProviderStatus: "RUNNING" }),
    ]),
    uncertain,
    "超时判死不是 Runway 说的失败",
  );
  assert.deepEqual(runwayFallbackDecision([failedByRunway({ lastProviderStatus: "CANCELLED" })]), uncertain);

  /// 还有段能用（同一条成片不出自两家）、客户取消过
  const usable = { fallback: false, reason: "still_usable" };
  assert.deepEqual(runwayFallbackDecision([failedByRunway(), failedByRunway({ status: "SUCCEEDED" })]), usable);
  assert.deepEqual(runwayFallbackDecision([failedByRunway(), failedByRunway({ status: "RUNNING" })]), usable);
  assert.deepEqual(runwayFallbackDecision([rejectedAtSubmit({ status: "CANCELLED" })]), usable);

  assert.deepEqual(runwayFallbackDecision([rejectedAtSubmit({ videoProviderAdapterSnapshot: "shuyu" })]), {
    fallback: false,
    reason: "not_runway",
  });
  assert.deepEqual(runwayFallbackDecision([]), { fallback: false, reason: "no_jobs" });
});

const STORY = "早高峰赶路，NORDA 随行保温杯陪你喝上热咖啡，到了办公室一上午还是热的。";
const PRODUCT_PHOTOS = ["https://blob.test/norda-0.jpg", "https://blob.test/norda-1.jpg"];
const FRAMES = [0, 1, 2, 3].map((ordinal) => `https://blob.test/frame-${ordinal}.png`);

/** 与派发入口一样：服务端 buildPlan 出的计划落库（JSON）再读回 */
async function nordaPlan(): Promise<Record<string, unknown>> {
  const request = unifiedVideoGenerationRequestSchema.parse({
    userType: "business",
    rawPrompt: STORY,
    attachments: [],
    selectedDuration: 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "none",
    language: "zh-CN",
    audio: {
      voiceover: {
        enabled: true,
        voiceId: "warm-confident",
        language: "zh-CN",
        script: "早高峰赶路，NORDA随行保温杯陪你喝上热咖啡。一上午热饮还是热的。",
      },
      bgm: { trackId: "none", volume: 0 },
    },
  });
  return JSON.parse(JSON.stringify(await buildPlan(request as UnifiedVideoGenerationRequest)));
}

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("换线路前还原改写前的段计划：由 brief 上的 videoGenerationPlan + language 重建，与派发入口那次一字不差", async () => {
  const plan = await nordaPlan();
  const original = roundTrip(mapPlanToDirectorPlan({ plan: plan as unknown as VideoGenerationPlan, language: "zh-CN" }));
  const klingGrounded = {
    ...original,
    segmentPlan: original.segmentPlan.map((segment) => ({
      ...segment,
      seedancePrompt: groundSegmentPromptForOpeningFrame(segment.seedancePrompt, {
        aspectRatio: "9:16",
        story: STORY,
        beats: ["镜头 1", "镜头 2", "镜头 3", "镜头 4"],
        productPhotoCount: 2,
        totalDurationSec: 15,
        fromSec: segment.fromSec,
        toSec: segment.toSec,
        negativePrompt: segment.negativePrompt,
      }),
    })),
    referenceLayout: { productPhotoCount: 2, anchorCount: 0, personCount: 0, frameCount: 4, limit: 8 },
  };
  assert.ok(klingGrounded.segmentPlan.every((segment) => segment.seedancePrompt.includes(STORYBOARD_GROUNDING_MARKER)));

  const restored = directorPlanBeforeGrounding({ directorPlan: klingGrounded, videoGenerationPlan: plan });
  assert.deepEqual(roundTrip(restored), original);
  assert.ok(restored?.segmentPlan.every((segment) => !segment.seedancePrompt.includes(STORYBOARD_GROUNDING_MARKER)));

  assert.equal(directorPlanBeforeGrounding({ directorPlan: klingGrounded, videoGenerationPlan: null }), null, "计划缺失");
  assert.equal(directorPlanBeforeGrounding({ directorPlan: "not a plan", videoGenerationPlan: plan }), null);
  assert.equal(
    directorPlanBeforeGrounding({
      directorPlan: {
        ...klingGrounded,
        segmentPlan: klingGrounded.segmentPlan.map((segment) => ({ ...segment, toSec: segment.toSec + 5, durationSec: segment.durationSec + 5 })),
      },
      videoGenerationPlan: plan,
    }),
    null,
    "分段与已派发的对不上就不换",
  );
});

// ---------------------------------------------------------------------------
// 派发 / 轮询全流程：Prisma 换成内存表，供应商提交与状态查询走 video-service 的测试注入，网络全断
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function patch(t: TestContext, target: unknown, values: Record<string, unknown>) {
  const object = target as Record<string, unknown>;
  const originals = Object.fromEntries(Object.keys(values).map((key) => [key, object[key]]));
  Object.assign(object, values);
  t.after(() => Object.assign(object, originals));
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((branch) => matches(row, branch));
    const value = row[key] ?? null;
    if (condition === null) return value === null;
    if (condition instanceof Date || typeof condition !== "object") return value === condition;
    const operators = condition as { in?: unknown[]; not?: unknown };
    if (operators.in) return operators.in.includes(value);
    if ("not" in operators) return operators.not === null ? value !== null : value !== operators.not;
    throw new Error(`fake db: unsupported condition on ${key}`);
  });
}

function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    const increment = value && typeof value === "object" ? (value as { increment?: number }).increment : undefined;
    row[key] = typeof increment === "number" ? Number(row[key] ?? 0) + increment : value;
  }
}

async function fakeVideoStore(t: TestContext, options: { route?: "runway" | "buddy" } = {}) {
  const plan = await nordaPlan();
  const brief: Row = {
    id: "brief-rw",
    status: "RENDER_QUEUED",
    aspectRatio: "9:16",
    targetDurationSec: 15,
    finalVideoId: null,
    errorMessage: null,
    referenceImageUrls: [],
    /// 派发入口落库的样子：未改写的段计划 + 服务端计划 + Runway 线路快照
    directorPlan: roundTrip(mapPlanToDirectorPlan({ plan: plan as unknown as VideoGenerationPlan, language: "zh-CN" })),
    videoGenerationPlan: plan,
    ...createVideoRouteSnapshot(options.route ?? "runway"),
  };
  const jobs: Row[] = [];
  const finalVideos: Row[] = [];
  const createFailure = { atCall: 0, calls: 0 };

  patch(t, db.videoBrief, {
    findUnique: async () => ({ ...brief }),
    update: async ({ data }: { data: Row }) => {
      apply(brief, data);
      return { ...brief };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      if (!matches(brief, where)) return { count: 0 };
      apply(brief, data);
      return { count: 1 };
    },
  });
  patch(t, db.videoJob, {
    findMany: async ({ where }: { where?: Row } = {}) => jobs.filter((job) => matches(job, where)).map((job) => ({ ...job })),
    findUnique: async ({ where }: { where: Row }) => {
      const job = jobs.find((row) => matches(row, where));
      return job ? { ...job } : null;
    },
    create: async ({ data }: { data: Row }) => {
      createFailure.calls += 1;
      if (createFailure.calls === createFailure.atCall) throw new Error("database unavailable");
      if (data.logicalJobKey != null && jobs.some((job) => job.logicalJobKey === data.logicalJobKey)) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on logicalJobKey", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      const row: Row = {
        externalJobId: null,
        errorMessage: null,
        userSafeError: null,
        lastProviderStatus: null,
        submissionErrorClass: null,
        replacesJobId: null,
        supersededAt: null,
        dispatchQuarantineDecision: null,
        retryCount: 0,
        createdAt: new Date(),
        ...data,
      };
      jobs.push(row);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const job of jobs) {
        if (!matches(job, where)) continue;
        apply(job, data);
        count += 1;
      }
      return { count };
    },
  });
  patch(t, db.finalVideo, {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `fv-${finalVideos.length + 1}`, ...data };
      finalVideos.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = finalVideos.find((video) => video.id === where.id) ?? {};
      apply(row, data);
      return row;
    },
  });
  patch(t, db.storyboardRun, {
    findUnique: async () => ({
      id: "run-rw",
      userId: "owner-1",
      status: "APPROVED",
      videoBriefId: "brief-rw",
      sourcePrompt: STORY,
      aspectRatio: "9:16",
      durationSec: 15,
      inputImageUrls: PRODUCT_PHOTOS,
      anchorCutoutUrls: [],
      personAssetIds: [],
      frames: FRAMES.map((url, ordinal) => ({
        id: `frame-${ordinal}`,
        ordinal,
        beat: `镜头 ${ordinal + 1}`,
        prompt: `frame ${ordinal + 1}`,
        status: "SUCCEEDED",
        isCurrent: true,
        outputAsset: { userId: "owner-1", url },
      })),
    }),
  });
  patch(t, db.mediaAsset, { findMany: async () => [] });
  patch(t, db, { $transaction: async (operation: (tx: typeof db) => Promise<unknown>) => operation(db) });

  /// Shuyu 的 /prices（成本快照）与任何真实供应商请求都不许出网
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network disabled in runway-fallback tests");
  }) as typeof fetch;
  __testVideoPlans__.resetVideoPlanCache();

  const submitted: CreateVideoJobOptions[] = [];
  const runway = { reject: true };
  const shuyuSubmit = { reject: false };
  videoService.__setSubmitterForTests(async (options) => {
    submitted.push(options);
    if (options.model === "klingO3_pro") {
      if (runway.reject) {
        throw new ProviderSubmissionError("Runway 400: promptText must be at most 2500 characters", {
          providerId: "runway",
          stage: "provider_response",
          httpStatus: 400,
          providerConfirmedNoJob: true,
        });
      }
      return { jobId: "rw-task-1" };
    }
    if (shuyuSubmit.reject) {
      throw new ProviderSubmissionError("Shuyu 422: The requested video option is unavailable", {
        providerId: "shuyu",
        stage: "provider_response",
        httpStatus: 422,
        providerConfirmedNoJob: true,
      });
    }
    return { jobId: `shuyu-task-${submitted.length}` };
  });
  const shuyu = { available: true };
  videoService.__setRunwayFallbackDepsForTests({
    backupSnapshot: (primaryRouteId) => createVideoRouteSnapshot(primaryRouteId === "buddy" ? "runway" : "buddy"),
    backupAvailability: async () =>
      shuyu.available
        ? { available: true, funded: true, reason: null }
        : { available: false, funded: false, reason: "insufficient_balance" },
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    __testVideoPlans__.resetVideoPlanCache();
    videoService.__setSubmitterForTests(null);
    videoService.__setStatusFetcherForTests(null);
    videoService.__setRunwayFallbackDepsForTests(null);
  });
  return { brief, jobs, submitted, runway, shuyu, shuyuSubmit, createFailure };
}

function assertShuyuTookOver(store: Awaited<ReturnType<typeof fakeVideoStore>>, shuyuOptions: CreateVideoJobOptions) {
  /// 按 Shuyu 重新改写：参考图带序号、没有 Kling 的开场帧句，参考图里没有 first_frame
  assert.equal(shuyuOptions.model, "studio-video");
  assert.ok(shuyuOptions.prompt.includes(STORYBOARD_GROUNDING_MARKER));
  assert.match(shuyuOptions.prompt, /reference image 3\)/, "第一张关键帧排在两张实拍后面");
  assert.doesNotMatch(shuyuOptions.prompt, /It opens exactly on the opening frame/);
  assert.deepEqual(shuyuOptions.referenceImages, [...PRODUCT_PHOTOS, ...FRAMES].map((url) => ({ url, role: "content" })));

  assert.equal(store.brief.videoRouteSnapshot, "buddy");
  assert.equal(store.brief.videoProviderAdapterSnapshot, "shuyu");
  assert.equal(store.brief.status, "RENDERING", "商家看到的仍是生成中");
  const persisted = store.brief.directorPlan as {
    segmentPlan: Array<{ seedancePrompt: string }>;
    referenceLayout: { limit: number };
  };
  assert.equal(persisted.segmentPlan[0].seedancePrompt, shuyuOptions.prompt, "重试 / 重做读的是 Shuyu 版");
  assert.equal(persisted.referenceLayout.limit, 9);

  const [runwayRow, shuyuRow] = store.jobs;
  assert.equal(store.jobs.length, 2);
  assert.equal(runwayRow.videoProviderAdapterSnapshot, "runway");
  assert.equal(runwayRow.status, "FAILED", "旧行留档，不删不改状态");
  assert.ok(runwayRow.supersededAt instanceof Date);
  assert.equal(runwayRow.finalVideoId, null);
  assert.equal(runwayRow.logicalJobKey, null);
  assert.equal(shuyuRow.videoProviderAdapterSnapshot, "shuyu");
  assert.equal(shuyuRow.logicalJobKey, "brief-rw:segment:0");
  assert.equal(shuyuRow.finalVideoId, store.brief.finalVideoId);
  assert.equal(shuyuRow.status, "RUNNING");
  return { runwayRow, shuyuRow };
}

test("派发当场被 Runway 拒：这条视频改交 Shuyu，商家拿到的是 Shuyu 在跑的任务", async (t) => {
  const store = await fakeVideoStore(t);
  const jobs = await dispatchVideoForBrief("brief-rw");

  assert.equal(store.submitted.length, 2);
  const [kling, shuyuOptions] = store.submitted;
  assert.equal(kling.model, "klingO3_pro");
  assert.match(kling.prompt, /It opens exactly on the opening frame/, "第一次是按 Kling 改写的");
  assert.ok(kling.referenceImages?.some((image) => image.role === "first_frame"));
  const { runwayRow, shuyuRow } = assertShuyuTookOver(store, shuyuOptions);
  assert.equal(runwayRow.submissionState, "REJECTED");
  assert.match(String(runwayRow.errorMessage), /2500/, "Runway 的拒单原因留在旧行上");
  assert.equal(shuyuRow.externalJobId, "shuyu-task-2");
  assert.deepEqual(
    jobs.map((job) => job.id),
    [shuyuRow.id],
  );
});

test("任务受理后被 Runway 判失败（审核拦截）：轮询里改交 Shuyu", async (t) => {
  const store = await fakeVideoStore(t);
  store.runway.reject = false;
  const [accepted] = await dispatchVideoForBrief("brief-rw");
  assert.equal(accepted.externalJobId, "rw-task-1");
  assert.equal(store.brief.videoRouteSnapshot, "runway");

  videoService.__setStatusFetcherForTests(async (providerJobId) => ({
    jobId: providerJobId,
    status: "failed",
    rawProviderStatus: "FAILED",
    errorMessage: "Input image flagged by moderation（SAFETY.INPUT.IMAGE）",
  }));
  const after = await reconcileVideoJob(String(accepted.id));

  assert.equal(after?.id, accepted.id);
  assert.equal(after?.status, "FAILED");
  const { runwayRow, shuyuRow } = assertShuyuTookOver(store, store.submitted[1]);
  assert.equal(runwayRow.externalJobId, "rw-task-1");
  assert.match(String(runwayRow.errorMessage), /SAFETY\.INPUT\.IMAGE/);
  assert.equal(shuyuRow.externalJobId, "shuyu-task-2");
});

test("Shuyu 接不了（积分不够）：一切照旧——返回被拒的 Runway 任务，由派发入口返还额度并报错", async (t) => {
  const store = await fakeVideoStore(t);
  store.shuyu.available = false;
  const jobs = await dispatchVideoForBrief("brief-rw");

  assert.equal(store.submitted.length, 1);
  assert.equal(store.brief.videoRouteSnapshot, "runway");
  assert.equal(store.jobs.length, 1);
  assert.equal(jobs[0].submissionState, "REJECTED");
  assert.equal(jobs[0].supersededAt, null);
  assert.equal(jobs[0].logicalJobKey, "brief-rw:segment:0");
});

test("换完后重新派发抛错：brief 置失败，不留没有任务的「生成中」，错误照抛给调用方", async (t) => {
  const store = await fakeVideoStore(t);
  /// 第 1 次建行是 Runway 那一段，第 2 次是改交 Shuyu 后的那一段
  store.createFailure.atCall = 2;

  await assert.rejects(() => dispatchVideoForBrief("brief-rw"), /database unavailable/);
  assert.equal(store.brief.videoRouteSnapshot, "buddy");
  assert.equal(store.brief.status, "RENDER_FAILED");
  assert.match(String(store.brief.errorMessage), /请重新生成故事板/);
});

// ---------------------------------------------------------------------------
// 10-29 反方向：Shuyu 是默认线路，Shuyu 生成失败再换 Runway（SHUYU_FALLBACK_TO_RUNWAY=off 关）
// ---------------------------------------------------------------------------

const rejectedByShuyu = (overrides: Partial<RunwayFallbackJob> = {}): RunwayFallbackJob =>
  rejectedAtSubmit({
    submissionErrorClass: "definitely_not_created:provider_response",
    errorMessage: "[provider:rejected] Shuyu 422: The requested video option is unavailable",
    videoProviderAdapterSnapshot: "shuyu",
    ...overrides,
  });

const refundedByShuyu = (overrides: Partial<RunwayFallbackJob> = {}): RunwayFallbackJob =>
  rejectedByShuyu({
    submissionState: "ACCEPTED",
    submissionErrorClass: null,
    externalJobId: "shuyu-task-1",
    errorMessage: `${PROVIDER_FAILED_ERROR_PREFIX} Shuyu generation failed and provider points were refunded`,
    lastProviderStatus: "refunded",
    ...overrides,
  });

test("反方向判据：Shuyu 当场拒单、退回积分才换；我们自己的预检（内容审核）拦下的不换，免得绕过审核", () => {
  assert.deepEqual(routeFallbackDecision([rejectedByShuyu()], "shuyu"), { fallback: true, trigger: "submit_rejected" });
  assert.deepEqual(routeFallbackDecision([refundedByShuyu()], "shuyu"), { fallback: true, trigger: "provider_failed" });
  assert.deepEqual(
    routeFallbackDecision([rejectedByShuyu({ submissionErrorClass: "definitely_not_created:preflight" })], "shuyu"),
    { fallback: false, reason: "uncertain" },
  );
  assert.deepEqual(routeFallbackDecision([refundedByShuyu({ lastProviderStatus: "refund_error" })], "shuyu"), {
    fallback: false,
    reason: "uncertain",
  });
  assert.deepEqual(routeFallbackDecision([refundedByShuyu(), refundedByShuyu({ status: "RUNNING" })], "shuyu"), {
    fallback: false,
    reason: "still_usable",
  });
  assert.deepEqual(routeFallbackDecision([rejectedAtSubmit()], "shuyu"), { fallback: false, reason: "not_shuyu" });
  /// Runway 方向照旧：它的本地预检（超 2500 字，Shuyu 收得下）照样换
  assert.deepEqual(
    runwayFallbackDecision([rejectedAtSubmit({ submissionErrorClass: "definitely_not_created:preflight" })]),
    { fallback: true, trigger: "submit_rejected" },
  );
});

test("派发当场被 Shuyu 拒：这条视频改交 Runway，按 Kling 开场帧版改写、第一张关键帧标 first_frame", async (t) => {
  const store = await fakeVideoStore(t, { route: "buddy" });
  store.shuyuSubmit.reject = true;
  store.runway.reject = false;
  const jobs = await dispatchVideoForBrief("brief-rw");

  assert.equal(store.submitted.length, 2);
  const [shuyuOptions, kling] = store.submitted;
  assert.equal(shuyuOptions.model, "studio-video");
  assert.equal(kling.model, "klingO3_pro");
  assert.match(kling.prompt, /It opens exactly on the opening frame/);
  assert.ok(kling.referenceImages?.some((image) => image.role === "first_frame"));
  assert.equal(store.brief.videoRouteSnapshot, "runway");
  assert.equal(store.brief.videoProviderAdapterSnapshot, "runway");
  assert.equal(store.brief.status, "RENDERING", "商家看到的仍是生成中");

  const [shuyuRow, runwayRow] = store.jobs;
  assert.equal(store.jobs.length, 2);
  assert.equal(shuyuRow.videoProviderAdapterSnapshot, "shuyu");
  assert.equal(shuyuRow.status, "FAILED", "旧行留档");
  assert.ok(shuyuRow.supersededAt instanceof Date);
  assert.equal(shuyuRow.logicalJobKey, null);
  assert.equal(runwayRow.videoProviderAdapterSnapshot, "runway");
  assert.equal(runwayRow.externalJobId, "rw-task-1");
  assert.equal(runwayRow.logicalJobKey, "brief-rw:segment:0");
  assert.deepEqual(
    jobs.map((job) => job.id),
    [runwayRow.id],
  );
});

test("Shuyu 受理后退回积分（refunded）：轮询里改交 Runway", async (t) => {
  const store = await fakeVideoStore(t, { route: "buddy" });
  store.runway.reject = false;
  const [accepted] = await dispatchVideoForBrief("brief-rw");
  assert.match(String(accepted.externalJobId), /^shuyu-task-/);

  videoService.__setStatusFetcherForTests(async (providerJobId) => ({
    jobId: providerJobId,
    status: "failed",
    rawProviderStatus: "refunded",
    errorMessage: "Shuyu generation failed and provider points were refunded",
  }));
  await reconcileVideoJob(String(accepted.id));

  assert.equal(store.brief.videoRouteSnapshot, "runway");
  assert.equal(store.submitted.at(-1)?.model, "klingO3_pro");
  assert.equal(store.jobs.length, 2);
  assert.ok(store.jobs[0].supersededAt instanceof Date);
});

test("一条视频只换一次：Runway 拒单换到 Shuyu、Shuyu 也拒，就不再换回 Runway（两家不来回扣费）", async (t) => {
  const store = await fakeVideoStore(t);
  store.shuyuSubmit.reject = true;
  await dispatchVideoForBrief("brief-rw");
  assert.equal(store.brief.videoRouteSnapshot, "buddy");
  assert.equal(store.submitted.length, 2);

  assert.equal(await videoService.fallBackBriefToBackupRoute("brief-rw"), null);
  assert.equal(store.brief.videoRouteSnapshot, "buddy");
  assert.equal(store.submitted.length, 2, "没有第三次提交");
});
