import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import {
  FinalVideoStatus,
  Prisma,
  ProviderSubmissionState,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import type { Session } from "next-auth";
import { db } from "../src/lib/db";
import { planSegments } from "../src/lib/duration/segment-planner";
import { parseDirectorPlan } from "../src/lib/schemas/director-plan";
import { __test__ as directorTest } from "../src/lib/services/director-service";
import {
  buildSegmentSubmitInput,
  commitSegmentRedo,
  retryFailedVideoJob,
  __test__ as videoTest,
  type PreparedSegmentRedo,
} from "../src/lib/services/video-service";
import {
  QUOTA_LEDGER_PHASE,
  rechargeRefundedSegmentRedoForSession,
  reconcileUndeliveredQuotaRefunds,
} from "../src/lib/services/quota-refund-service";
import {
  commitSegmentRedoRestitch,
  isStitchCandidateReady,
  rollbackRestitch,
} from "../src/lib/services/stitch-service";
import {
  cancelUnifiedOrderForUser,
  SEGMENT_REDO_CANCELLED_CLASS,
} from "../src/lib/services/single-video-cancel-service";
import { toUnifiedLibraryRow } from "../src/lib/services/unified-library-service";
import { FRAME_QA_ERROR_PREFIX } from "../src/lib/video-generation/frame-qa";
import {
  composeSegmentRedoPrompt,
  isCurrentSegmentJob,
  isSegmentRedoCandidate,
  isSupersededSegmentJob,
  parseSegmentRedoRequest,
  SegmentRedoRejectedError,
  segmentRedoLogicalJobKey,
  selectAllRetryTargets,
} from "../src/lib/video-generation/segment-redo";
import {
  createQuotaFakeDb,
  emptyStore,
  meterAmount,
  type QuotaFakeStore,
  type Row,
} from "./helpers/quota-fake-db";

/**
 * P05-C 成功段重做：候选行 → 扣 1 段 → 提交；失败 / 取消退回这 1 段；成功后同一事务换挂并走 #16 的只重拼
 * （旧成片一直 READY，合成失败回滚到旧片）。内存版 Prisma（在 quota-fake-db 上补 create / finalVideo），
 * 供应商走 __setSubmitterForTests，不连库、不发任何网络请求、不跑 ffmpeg。
 */

const USER = "customer-1";
const BRIEF = "brief-1";
const FV = "fv-1";
const OLD_URL = "https://abc.public.blob.vercel-storage.com/final-videos/fv-1/old.mp4";
const SEG0_URL = "https://abc.public.blob.vercel-storage.com/seg0.mp4";
const SEG1_URL = "https://abc.public.blob.vercel-storage.com/seg1.mp4";
const REDO_URL = "https://abc.public.blob.vercel-storage.com/seg0-redo.mp4";
const CREATED = new Date(Date.now() - 60 * 60_000);

const BYTEPLUS_ROUTE = {
  videoRouteSnapshot: "byteplus_international" as const,
  videoModelSnapshot: "dreamina-seedance-2-0-260128",
  videoProviderAdapterSnapshot: "byteplus" as const,
};

const CUSTOMER: Session = {
  user: { id: USER, email: "c@example.test", role: "OPERATOR", userType: "BUSINESS" },
  expires: "2099-01-01T00:00:00.000Z",
};

const POST_PRODUCTION = {
  audio: { voiceover: { enabled: false }, bgm: { trackId: "none", volume: 0 } },
  captions: { enabled: true, style: "plain", language: "zh", position: "bottom", exportSrt: true },
};

function directorPlan() {
  return parseDirectorPlan(
    directorTest.mockDirectorPlan({
      targetDurationSec: 30,
      segmentSlots: planSegments(30),
      clientBrief: { businessName: "Acme", productName: "Acme Pro" },
      productInput: {},
      targetCountry: "US",
      targetLanguage: "en-US",
      targetPlatform: "tiktok",
      angle: {
        title: "Product proof",
        hook: "Show the real product",
        narrative: null,
        type: "OPTIMIZATION",
        explorationTheme: null,
        localeNotes: null,
      },
    }),
  );
}

const PLAN = directorPlan();
const SEGMENT_COUNT = PLAN.segmentPlan.length;

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

/// 真实 provider 模式 + 计量开启；所有提交走测试钩子，任何网络请求直接炸
function installRuntime(t: TestContext, submitter: (prompt: string) => Promise<{ jobId: string }>) {
  withEnv(t, {
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "false",
    VERCEL_ENV: "preview",
    QUOTA_ENFORCE: "true",
    STITCH_RUNTIME: "external",
    ENABLE_VIDEO_STITCHING: undefined,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    throw new Error(`unexpected network call in segment redo test: ${String(input)}`);
  };
  const prompts: string[] = [];
  videoTest.__setSubmitterForTests(async (options) => {
    prompts.push(options.prompt);
    return submitter(options.prompt);
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    videoTest.__setSubmitterForTests(null);
  });
  t.mock.method(console, "info", () => undefined);
  t.mock.method(console, "log", () => undefined);
  return prompts;
}

type RedoStore = QuotaFakeStore & { finalVideos: Row[] };

function segmentRow(segmentIndex: number, overrides: Row = {}): Row {
  return {
    id: `seg-${segmentIndex}`,
    videoBriefId: BRIEF,
    batchJobId: null,
    finalVideoId: FV,
    segmentIndex,
    segmentDurationSec: 5,
    status: VideoJobStatus.SUCCEEDED,
    submissionState: ProviderSubmissionState.ACCEPTED,
    provider: VideoProvider.SEEDANCE_T2V,
    ...BYTEPLUS_ROUTE,
    outputVideoUrl: segmentIndex === 0 ? SEG0_URL : SEG1_URL,
    outputThumbUrl: null,
    externalJobId: `ext-seg-${segmentIndex}`,
    replacesJobId: null,
    supersededAt: null,
    quotaRefundedAt: null,
    frameQaDetail: segmentIndex === 0 ? { v: 1, blockCount: 1 } : null,
    createdAt: CREATED,
    submittedAt: CREATED,
    finishedAt: CREATED,
    retryCount: 0,
    submitAttempts: 1,
    dispatchQuarantineDecision: null,
    ...overrides,
  };
}

function redoStore(): RedoStore {
  const store = emptyStore() as RedoStore;
  store.briefs.push({
    id: BRIEF,
    ownerId: USER,
    status: VideoBriefStatus.QA_PENDING,
    aspectRatio: "9:16",
    directorPlan: PLAN,
    referenceImageUrls: [],
    videoGenerationPlan: null,
    finalVideoId: FV,
  });
  store.videoJobs.push(
    ...Array.from({ length: SEGMENT_COUNT }, (_, index) => segmentRow(index)),
  );
  store.finalVideos = [
    {
      id: FV,
      briefId: BRIEF,
      status: FinalVideoStatus.READY,
      segmentCount: SEGMENT_COUNT,
      stitchedVideoUrl: OLD_URL,
      previousStitchedVideoUrl: null,
      postProduction: POST_PRODUCTION,
      previousPostProduction: null,
      stitchAttempts: 1,
      stitchAttemptToken: null,
      ffmpegError: null,
    },
  ];
  return store;
}

function scalarMatch(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === "object" && "in" in (condition as Row)) {
      return ((condition as Row).in as unknown[]).includes(row[key]);
    }
    if (condition === null) return row[key] === null || row[key] === undefined;
    return row[key] === condition;
  });
}

/**
 * quota-fake-db 的模型 + 候选行需要的 create（logicalJobKey 唯一约束）/ update / 带 videoBrief 的 findUnique
 * + finalVideo。事务串行执行（等价于 Serializable 的结果），抛错整体回滚。
 */
function installRedoDb(t: TestContext, store: RedoStore) {
  const models = createQuotaFakeDb(store) as unknown as Record<string, Record<string, unknown>>;
  const briefView = (briefId: unknown) => {
    const brief = store.briefs.find((row) => row.id === briefId);
    return brief
      ? { ...brief, contentAngle: { round: { deliveryOrder: { createdById: brief.ownerId ?? null } } } }
      : null;
  };
  const findJob = (id: unknown) => store.videoJobs.find((row) => row.id === id);
  const stats = { jobCreates: 0, finalVideoWrites: 0 };
  Object.assign(models.videoJob, {
    findUnique: async ({ where }: { where: Row }) => {
      const row = findJob(where.id);
      return row ? { ...row, batchJob: null, videoBrief: briefView(row.videoBriefId) } : null;
    },
    create: async ({ data }: { data: Row }) => {
      if (data.logicalJobKey && store.videoJobs.some((row) => row.logicalJobKey === data.logicalJobKey)) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on logicalJobKey", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      stats.jobCreates += 1;
      const row: Row = {
        createdAt: new Date(),
        batchJobId: null,
        externalJobId: null,
        supersededAt: null,
        quotaRefundedAt: null,
        retryCount: 0,
        submitAttempts: 0,
        errorMessage: null,
        outputVideoUrl: null,
        dispatchQuarantineDecision: null,
        ...data,
      };
      store.videoJobs.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = findJob(where.id);
      if (!row) throw new Error("missing job");
      Object.assign(row, data);
      return { ...row };
    },
  });
  models.finalVideo = {
    findUnique: async ({ where }: { where: Row }) => {
      const fv = store.finalVideos.find((row) => row.id === where.id);
      if (!fv) return null;
      const segments = store.videoJobs
        .filter((job) => job.finalVideoId === fv.id)
        .sort((a, b) => Number(a.segmentIndex) - Number(b.segmentIndex))
        .map((job) => ({ ...job }));
      return { ...fv, brief: { id: fv.briefId, status: VideoBriefStatus.QA_PENDING }, segments };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = store.finalVideos.filter((row) => scalarMatch(row, where));
      for (const row of rows) Object.assign(row, data);
      stats.finalVideoWrites += rows.length;
      return { count: rows.length };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = store.finalVideos.find((fv) => fv.id === where.id);
      if (!row) throw new Error("missing final video");
      Object.assign(row, data);
      stats.finalVideoWrites += 1;
      return { ...row };
    },
  };

  const target = db as unknown as Record<string, unknown>;
  const restores: Array<() => void> = [];
  for (const [modelName, methods] of Object.entries(models)) {
    const model = target[modelName] as Record<string, unknown>;
    for (const [method, fn] of Object.entries(methods)) {
      const original = model[method];
      model[method] = fn;
      restores.push(() => {
        model[method] = original;
      });
    }
  }
  let chain: Promise<unknown> = Promise.resolve();
  const originalTransaction = target.$transaction;
  target.$transaction = (operation: (tx: unknown) => Promise<unknown>) => {
    const run = chain.then(async () => {
      const snapshot = structuredClone(store);
      try {
        return await operation(models);
      } catch (error) {
        Object.assign(store, snapshot);
        throw error;
      }
    });
    chain = run.catch(() => undefined);
    return run;
  };
  restores.push(() => {
    target.$transaction = originalTransaction;
  });
  t.after(() => {
    for (const restore of restores.reverse()) restore();
  });
  return stats;
}

function prepared(overrides: Partial<PreparedSegmentRedo> = {}): PreparedSegmentRedo {
  return {
    briefId: BRIEF,
    finalVideoId: FV,
    segmentIndex: 0,
    replacesJobId: "seg-0",
    segmentDurationSec: null,
    priorFrameQaBlockCount: 1,
    note: "别出现文字",
    routeSnapshot: BYTEPLUS_ROUTE,
    brief: {
      aspectRatio: "9:16",
      directorPlan: PLAN as unknown as Prisma.JsonValue,
      referenceImageUrls: [],
      videoGenerationPlan: null,
    },
    ...overrides,
  } as PreparedSegmentRedo;
}

function candidates(store: RedoStore): Row[] {
  return store.videoJobs.filter((row) => row.replacesJobId != null);
}

function redoLogs(store: RedoStore, candidateJobId: string): Row[] {
  return store.usageLogs.filter((log) => (log.metadata as Row | undefined)?.candidateJobId === candidateJobId);
}

function periodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 纯规则
// ---------------------------------------------------------------------------

test("三种行：当前段 / 候选行 / 旧行互斥；旧单段流程（无 replacesJobId）算当前段", () => {
  const current = { replacesJobId: null, finalVideoId: FV, supersededAt: null };
  const candidate = { replacesJobId: "seg-0", finalVideoId: null, supersededAt: null };
  const adopted = { replacesJobId: "seg-0", finalVideoId: FV, supersededAt: null };
  const old = { replacesJobId: null, finalVideoId: null, supersededAt: new Date() };
  const legacy = { replacesJobId: null, finalVideoId: null, supersededAt: null };
  assert.equal(isCurrentSegmentJob(current), true);
  assert.equal(isSegmentRedoCandidate(candidate), true);
  assert.equal(isCurrentSegmentJob(candidate), false);
  assert.equal(isCurrentSegmentJob(adopted), true, "换挂后的候选行就是当前段");
  assert.equal(isSupersededSegmentJob(old), true);
  assert.equal(isCurrentSegmentJob(old), false);
  assert.equal(isCurrentSegmentJob(legacy), true);
  assert.equal(isCurrentSegmentJob({}), true, "字段缺省（旧夹具）按当前段算");
  assert.equal(segmentRedoLogicalJobKey(BRIEF, 1, 3), "brief-1:segment:1:redo:3");
});

test("请求校验：要点名一段，说明裁剪后最多 400 字；多余字段拒绝", () => {
  assert.deepEqual(parseSegmentRedoRequest({ segmentIndex: 1, promptOverride: "  慢一点  " }), {
    segmentIndex: 1,
    promptOverride: "慢一点",
  });
  for (const bad of [null, {}, { segmentIndex: -1 }, { segmentIndex: 1.5 }, { segmentIndex: 0, promptOverride: "x".repeat(401) }, { segmentIndex: 0, extra: 1 }]) {
    assert.throws(
      () => parseSegmentRedoRequest(bad),
      (err: unknown) => err instanceof SegmentRedoRejectedError && err.code === "VALIDATION_FAILED",
    );
  }
});

test("重做提示词每次都从计划重组：说明只追加一次，换说明不叠加上一次", () => {
  const brief = prepared().brief;
  const segment = PLAN.segmentPlan[0];
  const first = buildSegmentSubmitInput({ briefId: BRIEF, brief, segmentIndex: 0, providerRequestKey: "k1", model: "m", redoNote: "别出现文字" });
  const second = buildSegmentSubmitInput({ briefId: BRIEF, brief, segmentIndex: 0, providerRequestKey: "k2", model: "m", redoNote: "镜头慢一点" });
  const plain = buildSegmentSubmitInput({ briefId: BRIEF, brief, segmentIndex: 0, providerRequestKey: "k3", model: "m" });
  assert.equal(plain.options.prompt, segment.seedancePrompt, "非重做：计划原样");
  assert.ok(first.options.prompt.startsWith(segment.seedancePrompt));
  assert.ok(second.options.prompt.startsWith(segment.seedancePrompt));
  assert.match(first.options.prompt, /别出现文字/);
  assert.doesNotMatch(second.options.prompt, /别出现文字/, "上一次的说明不累加");
  assert.match(second.options.prompt, /镜头慢一点/);
  assert.equal(first.options.resolution, "1080p");
  assert.equal(
    composeSegmentRedoPrompt({ planPrompt: "P", note: null, negativePrompt: "" }),
    "P",
    "没写说明 = 按计划原样重做",
  );
  assert.throws(
    () => composeSegmentRedoPrompt({ planPrompt: "x".repeat(4890), note: "多写一点", negativePrompt: "" }),
    (err: unknown) => err instanceof SegmentRedoRejectedError && err.code === "VALIDATION_FAILED",
  );
});

test("all:true 遇到候选行：失败的当前段照旧重试；候选行每段只重试最新且失败的那条；旧行不碰", () => {
  const rows = [
    { id: "cur-fail", status: "FAILED", segmentIndex: 1, finalVideoId: FV, replacesJobId: null, supersededAt: null },
    { id: "cur-ok", status: "SUCCEEDED", segmentIndex: 0, finalVideoId: FV, replacesJobId: null, supersededAt: null },
    { id: "old", status: "FAILED", segmentIndex: 2, finalVideoId: null, replacesJobId: null, supersededAt: new Date() },
    { id: "redo-0-a", status: "FAILED", segmentIndex: 0, finalVideoId: null, replacesJobId: "cur-ok", supersededAt: null },
    { id: "redo-0-b", status: "FAILED", segmentIndex: 0, finalVideoId: null, replacesJobId: "cur-ok", supersededAt: null },
    { id: "redo-2-a", status: "FAILED", segmentIndex: 2, finalVideoId: null, replacesJobId: "x", supersededAt: null },
    { id: "redo-2-b", status: "CANCELLED", segmentIndex: 2, finalVideoId: null, replacesJobId: "x", supersededAt: null },
  ];
  const { current, candidates: redo } = selectAllRetryTargets(rows);
  assert.deepEqual(current.map((row) => row.id), ["cur-fail"], "候选行不进 brief 级重试（也不触发 brief 补扣）");
  assert.deepEqual(redo.map((row) => row.id), ["redo-0-b"], "更早的失败候选与被取消取代的不重试");
});

test("拼接守卫：同一 segmentIndex 挂了两行（换挂漏摘旧行）不算可拼", () => {
  const ok = { status: VideoJobStatus.SUCCEEDED, outputVideoUrl: SEG0_URL };
  assert.equal(isStitchCandidateReady({ segmentCount: 2, segments: [{ ...ok, segmentIndex: 0 }, { ...ok, segmentIndex: 1 }] }), true);
  assert.equal(isStitchCandidateReady({ segmentCount: 2, segments: [{ ...ok, segmentIndex: 0 }, { ...ok, segmentIndex: 0 }] }), false);
});

// ---------------------------------------------------------------------------
// 扣费：双击只扣一次；提交失败退回 1 段；重做失败后再重做
// ---------------------------------------------------------------------------

test("双击只扣一次：两个并发重做只建一条候选行、只扣 1 段；后到的 INVALID_STATE", async (t) => {
  const prompts = installRuntime(t, async () => ({ jobId: "ext-redo-1" }));
  const store = redoStore();
  installRedoDb(t, store);

  const results = await Promise.allSettled([
    commitSegmentRedo(prepared(), { session: CUSTOMER }),
    commitSegmentRedo(prepared(), { session: CUSTOMER }),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof SegmentRedoRejectedError);
  assert.equal((rejected[0].reason as SegmentRedoRejectedError).code, "INVALID_STATE");

  const [candidate] = candidates(store);
  assert.equal(candidates(store).length, 1);
  assert.equal(candidate.logicalJobKey, "brief-1:segment:0:redo:1");
  assert.equal(candidate.finalVideoId, null, "候选行不挂成片");
  assert.equal(candidate.replacesJobId, "seg-0");
  assert.equal(candidate.status, VideoJobStatus.RUNNING);
  assert.equal(candidate.submissionState, ProviderSubmissionState.ACCEPTED);
  assert.equal(candidate.externalJobId, "ext-redo-1");
  assert.equal(candidate.promptText, "别出现文字", "候选行只存说明，提示词每次从计划重组");
  assert.deepEqual(candidate.frameQaDetail, { v: 1, inheritedFromJobId: "seg-0", blockCount: 1 }, "帧质检拦截次数从旧行继承");
  assert.equal(prompts.length, 1, "供应商只被调用一次");

  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 1);
  const logs = redoLogs(store, String(candidate.id));
  assert.deepEqual(
    logs.map((log) => [log.resource, log.amount, (log.metadata as Row).phase]),
    [["SEEDANCE_SEGMENT", 1, QUOTA_LEDGER_PHASE.segmentRedoAuthorization]],
  );
  const old = store.videoJobs.find((row) => row.id === "seg-0");
  assert.equal(old?.finalVideoId, FV, "旧行仍挂在成片上");
  assert.equal(store.finalVideos[0].status, FinalVideoStatus.READY, "旧成片一直 READY");
});

test("唯一约束兜底：建候选行撞 P2002（并发重放到上限）→ INVALID_STATE，不留扣费", async (t) => {
  installRuntime(t, async () => ({ jobId: "never" }));
  const store = redoStore();
  const stats = installRedoDb(t, store);
  /// 另一个请求已经占了 redo:1 这个键（但它的候选行在本事务的快照里看不见）→ 每次重放都撞唯一约束
  store.videoJobs.push(segmentRow(0, { id: "racing", finalVideoId: null, logicalJobKey: "brief-1:segment:0:redo:1" }));

  await assert.rejects(
    commitSegmentRedo(prepared(), { session: CUSTOMER }),
    (err: unknown) => err instanceof SegmentRedoRejectedError && err.code === "INVALID_STATE",
  );
  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 0);
  assert.equal(store.usageLogs.length, 0);
  assert.equal(stats.jobCreates, 0, "没有留下候选行");
});

test("提交失败退回 1 段：候选行 FAILED + 退额标记，计量回到 0，成片不动", async (t) => {
  installRuntime(t, async () => {
    throw new Error("provider rejected: content policy");
  });
  t.mock.method(console, "warn", () => undefined);
  const store = redoStore();
  const stats = installRedoDb(t, store);

  const job = await commitSegmentRedo(prepared(), { session: CUSTOMER });
  assert.equal(job.status, VideoJobStatus.FAILED);
  const [candidate] = candidates(store);
  assert.ok(candidate.quotaRefundedAt instanceof Date, "立即退回，不等清扫");
  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 0);
  assert.deepEqual(
    redoLogs(store, String(candidate.id)).map((log) => [log.amount, (log.metadata as Row).phase]),
    [
      [1, QUOTA_LEDGER_PHASE.segmentRedoAuthorization],
      [-1, QUOTA_LEDGER_PHASE.segmentRedoRefund],
    ],
  );
  assert.equal(stats.finalVideoWrites, 0, "候选行永远不重置成片");
  assert.equal(store.finalVideos[0].status, FinalVideoStatus.READY);

  /// 清扫器再跑一遍：已退过的不会再退
  const sweep = await reconcileUndeliveredQuotaRefunds(new Date(), { cutoff: new Date(0) });
  assert.deepEqual(sweep.refundedRedoCandidates, []);
  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 0);
});

test("重做失败后再重做同一段：新候选行 redo:2、再扣 1 段；失败的旧候选不能再被重试", async (t) => {
  let fail = true;
  installRuntime(t, async () => {
    if (fail) throw new Error("provider rejected");
    return { jobId: "ext-redo-2" };
  });
  t.mock.method(console, "warn", () => undefined);
  const store = redoStore();
  installRedoDb(t, store);

  const first = await commitSegmentRedo(prepared(), { session: CUSTOMER });
  assert.equal(first.status, VideoJobStatus.FAILED);
  fail = false;
  const second = await commitSegmentRedo(prepared({ note: "镜头慢一点" }), { session: CUSTOMER });
  assert.equal(second.status, VideoJobStatus.RUNNING);
  assert.equal(
    store.videoJobs.find((row) => row.id === second.id)?.logicalJobKey,
    "brief-1:segment:0:redo:2",
  );
  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 1, "第一次退了，第二次扣了");

  /// 第一次的候选行此时不能再重试（已经有一条在跑）
  const firstRow = store.videoJobs.find((row) => row.id === first.id) as Row;
  firstRow.submissionState = ProviderSubmissionState.REJECTED;
  firstRow.externalJobId = null;
  await assert.rejects(
    retryFailedVideoJob(String(first.id)),
    (err: unknown) => err instanceof SegmentRedoRejectedError && err.code === "INVALID_STATE",
  );
});

// ---------------------------------------------------------------------------
// 帧质检拦截的候选行重试；已退额的候选行重试要补扣
// ---------------------------------------------------------------------------

test("候选行被帧质检拦截后重试：按计划 + 自己的说明重提，不重置成片，拦截次数保留", async (t) => {
  const prompts = installRuntime(t, async () => ({ jobId: "ext-redo-retry" }));
  const store = redoStore();
  const stats = installRedoDb(t, store);
  store.videoJobs.push(
    segmentRow(0, {
      id: "redo-qa",
      finalVideoId: null,
      replacesJobId: "seg-0",
      status: VideoJobStatus.FAILED,
      externalJobId: "ext-redo-qa",
      providerRequestKey: "redo-qa:attempt:1",
      errorMessage: `${FRAME_QA_ERROR_PREFIX} text overlay detected`,
      frameQaDetail: { v: 1, inheritedFromJobId: "seg-0", blockCount: 2 },
      promptText: "别出现文字",
      createdAt: new Date(),
    }),
  );

  const job = await retryFailedVideoJob("redo-qa");
  assert.equal(job.status, VideoJobStatus.RUNNING);
  assert.equal(job.externalJobId, "ext-redo-retry");
  assert.equal(job.retryCount, 1);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].startsWith(PLAN.segmentPlan[0].seedancePrompt), "从计划重组");
  assert.equal(prompts[0].split("别出现文字").length - 1, 1, "说明只出现一次");
  const row = store.videoJobs.find((r) => r.id === "redo-qa") as Row;
  assert.equal(row.finalVideoId, null, "重试不换挂");
  assert.deepEqual(row.frameQaDetail, { v: 1, inheritedFromJobId: "seg-0", blockCount: 2 });
  assert.equal(stats.finalVideoWrites, 0, "候选行重试不重置成片");
  assert.equal(store.finalVideos[0].status, FinalVideoStatus.READY);
});

test("已退额的候选行重试前补扣 1 段并清标记；非主人会话补扣失败关闭", async (t) => {
  installRuntime(t, async () => {
    throw new Error("provider rejected");
  });
  t.mock.method(console, "warn", () => undefined);
  const store = redoStore();
  installRedoDb(t, store);
  const failed = await commitSegmentRedo(prepared(), { session: CUSTOMER });
  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 0);

  const stranger: Session = { ...CUSTOMER, user: { ...CUSTOMER.user, id: "someone-else" } };
  await assert.rejects(rechargeRefundedSegmentRedoForSession(stranger, String(failed.id)));
  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 0);

  const result = await rechargeRefundedSegmentRedoForSession(CUSTOMER, String(failed.id));
  assert.deepEqual(result, { recharged: true, cleared: true });
  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 1);
  const row = store.videoJobs.find((r) => r.id === failed.id) as Row;
  assert.equal(row.quotaRefundedAt, null);
  assert.equal(
    redoLogs(store, String(failed.id)).at(-1)?.metadata && (redoLogs(store, String(failed.id)).at(-1)?.metadata as Row).phase,
    QUOTA_LEDGER_PHASE.segmentRedoRetryRecharge,
  );
});

test("清扫器兜底：生成失败的候选行（没在提交路上）退回 1 段，只退一次", async (t) => {
  installRuntime(t, async () => ({ jobId: "ext" }));
  const store = redoStore();
  installRedoDb(t, store);
  const job = await commitSegmentRedo(prepared(), { session: CUSTOMER });
  const row = store.videoJobs.find((r) => r.id === job.id) as Row;
  Object.assign(row, { status: VideoJobStatus.FAILED, finishedAt: new Date(), errorMessage: "provider failed" });

  const sweep = await reconcileUndeliveredQuotaRefunds(new Date(), { cutoff: new Date(0) });
  assert.deepEqual(sweep.refundedRedoCandidates, [job.id]);
  assert.equal(meterAmount(store, USER, periodKey(), "SEEDANCE_SEGMENT"), 0);
  const again = await reconcileUndeliveredQuotaRefunds(new Date(), { cutoff: new Date(0) });
  assert.deepEqual(again.refundedRedoCandidates, []);
});

// ---------------------------------------------------------------------------
// 取消：只取消候选行，不动订单
// ---------------------------------------------------------------------------

test("取消只取消候选行：清幂等键、退回 1 段；订单、当前段、成片都不动", async (t) => {
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  const order = {
    id: "order-1",
    rounds: [{ angles: [{ videoBrief: {
      id: BRIEF,
      finalVideoId: FV,
      videoJobs: [
        { id: "seg-0", status: VideoJobStatus.SUCCEEDED, replacesJobId: null, finalVideoId: FV, supersededAt: null },
        { id: "seg-1", status: VideoJobStatus.SUCCEEDED, replacesJobId: null, finalVideoId: FV, supersededAt: null },
        { id: "redo-1", status: VideoJobStatus.RUNNING, replacesJobId: "seg-0", finalVideoId: null, supersededAt: null },
      ],
      finalVideo: { status: FinalVideoStatus.READY, previousStitchedVideoUrl: null },
    } }] }],
  };
  const restore: Array<() => void> = [];
  const patch = (model: Record<string, unknown>, values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      const original = model[key];
      model[key] = value;
      restore.push(() => {
        model[key] = original;
      });
    }
  };
  const writes: Array<{ where: Row; data: Row }> = [];
  patch(anyDb.deliveryOrder, {
    findFirst: async () => order,
    update: async () => {
      throw new Error("取消重做不得取消订单");
    },
  });
  patch(anyDb.videoJob, {
    updateMany: async (args: { where: Row; data: Row }) => {
      writes.push(args);
      return { count: 1 };
    },
  });
  patch(anyDb.finalVideo, {
    updateMany: async () => {
      throw new Error("成片不是重拼中，不该回滚");
    },
  });
  patch(db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      throw new Error("没有订单级可取消的任务，不该开事务");
    },
  });
  t.after(() => {
    for (const fn of restore.reverse()) fn();
  });
  const refunds: string[] = [];

  const result = await cancelUnifiedOrderForUser("user-1", "order-1", new Date(), {
    refund: async () => {
      throw new Error("不得按单返还");
    },
    refundRedo: async (jobId) => {
      refunds.push(jobId);
      return "refunded";
    },
  });
  assert.deepEqual(result, { ok: true, cancelledJobs: 1, refundedBriefs: 0, restitchRolledBack: 0, cancelledRedos: 1 });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].where.id, { in: ["redo-1"] }, "只动候选行");
  assert.deepEqual(writes[0].where.finalVideoId, null);
  assert.equal(writes[0].data.status, VideoJobStatus.CANCELLED);
  assert.equal(writes[0].data.submissionErrorClass, SEGMENT_REDO_CANCELLED_CLASS);
  assert.equal(writes[0].data.logicalJobKey, null, "取消清幂等键");
  assert.deepEqual(refunds, ["redo-1"]);
});

// ---------------------------------------------------------------------------
// 成功：换挂 + 走 #16 只重拼；合成失败回滚到旧片
// ---------------------------------------------------------------------------

test("成功后同一事务换挂：旧行摘下写 supersededAt、新行挂上、成片 READY→PENDING 带旧片；合成失败走统一回滚", async (t) => {
  installRuntime(t, async () => ({ jobId: "unused" }));
  const store = redoStore();
  installRedoDb(t, store);
  store.videoJobs.push(
    segmentRow(0, {
      id: "redo-ok",
      finalVideoId: null,
      replacesJobId: "seg-0",
      status: VideoJobStatus.SUCCEEDED,
      outputVideoUrl: REDO_URL,
      createdAt: new Date(),
    }),
  );
  const now = new Date();

  const adoption = await commitSegmentRedoRestitch("redo-ok", { now });
  assert.equal(adoption.adopted, true);
  const old = store.videoJobs.find((row) => row.id === "seg-0") as Row;
  const redo = store.videoJobs.find((row) => row.id === "redo-ok") as Row;
  assert.equal(old.finalVideoId, null, "旧行摘下（素材保留）");
  assert.equal((old.supersededAt as Date).getTime(), now.getTime());
  assert.equal(old.outputVideoUrl, SEG0_URL, "旧素材不删");
  assert.equal(redo.finalVideoId, FV, "新段挂上成片");
  const fv = store.finalVideos[0];
  assert.equal(fv.status, FinalVideoStatus.PENDING);
  assert.equal(fv.previousStitchedVideoUrl, OLD_URL, "旧片 URL 是回滚依据");
  assert.deepEqual(fv.previousPostProduction, POST_PRODUCTION);
  assert.equal(fv.stitchAttempts, 0);
  assert.equal(
    store.videoJobs.filter((row) => row.finalVideoId === FV && row.segmentIndex === 0).length,
    1,
    "每个 segmentIndex 只挂一行",
  );

  /// 合成失败（任何一条回滚边）→ 统一回滚出口：回到旧片 URL + 旧快照，成片又是 READY
  const rolled = await rollbackRestitch(FV, "合成失败");
  assert.equal(rolled.rolledBack, true);
  assert.equal(fv.status, FinalVideoStatus.READY);
  assert.equal(fv.stitchedVideoUrl, OLD_URL);
  assert.equal(fv.previousStitchedVideoUrl, null);
});

test("换挂守卫：成片在重拼中先不换（等下一轮）；旧行已被摘下则候选行退役，不重复挂", async (t) => {
  installRuntime(t, async () => ({ jobId: "unused" }));
  t.mock.method(console, "warn", () => undefined);
  const store = redoStore();
  installRedoDb(t, store);
  store.videoJobs.push(
    segmentRow(0, {
      id: "redo-ok",
      finalVideoId: null,
      replacesJobId: "seg-0",
      status: VideoJobStatus.SUCCEEDED,
      outputVideoUrl: REDO_URL,
    }),
  );
  store.finalVideos[0].previousStitchedVideoUrl = "https://abc.public.blob.vercel-storage.com/older.mp4";
  store.finalVideos[0].status = FinalVideoStatus.STITCHING;
  assert.deepEqual(await commitSegmentRedoRestitch("redo-ok"), { adopted: false, reason: "final_video_busy" });
  assert.equal((store.videoJobs.find((row) => row.id === "seg-0") as Row).finalVideoId, FV, "什么都没换");

  const old = store.videoJobs.find((row) => row.id === "seg-0") as Row;
  Object.assign(old, { finalVideoId: null, supersededAt: new Date() });
  assert.deepEqual(await commitSegmentRedoRestitch("redo-ok"), { adopted: false, reason: "replaced_row_detached" });
  const redo = store.videoJobs.find((row) => row.id === "redo-ok") as Row;
  assert.ok(redo.supersededAt instanceof Date, "候选行退役，不再算在途");
  assert.equal(redo.finalVideoId, null);
});

// ---------------------------------------------------------------------------
// 成品库：候选行不改成品状态；在途时不能只重拼、不能重做别的段
// ---------------------------------------------------------------------------

function libraryOrder(videoJobs: Row[]) {
  return {
    id: "order-1",
    title: "Acme",
    createdAt: CREATED,
    updatedAt: CREATED,
    rounds: [{ angles: [{ videoBrief: {
      id: BRIEF,
      status: VideoBriefStatus.QA_PENDING,
      durationSec: 15,
      aspectRatio: "9:16",
      finalVideoUrl: null,
      finalThumbnailUrl: null,
      brandedVideoUrl: null,
      takedownAt: null,
      createdAt: CREATED,
      storyboardRun: null,
      finalVideo: {
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: OLD_URL,
        thumbnailUrl: null,
        subtitleFileUrl: null,
        segmentCount: 2,
        startedAt: CREATED,
        finishedAt: CREATED,
        postProduction: POST_PRODUCTION,
      },
      videoJobs,
    } }] }],
  } as unknown as Parameters<typeof toUnifiedLibraryRow>[0];
}

test("成品库：重做在途 → 仍 READY、不能只重拼、各段都不能再点重做；失败 → 显示原因可再做", () => {
  const seg = (index: number, overrides: Row = {}) => ({
    id: `seg-${index}`,
    status: VideoJobStatus.SUCCEEDED,
    lastProgress: 100,
    submittedAt: CREATED,
    finishedAt: CREATED,
    createdAt: CREATED,
    outputVideoUrl: index === 0 ? SEG0_URL : SEG1_URL,
    segmentIndex: index,
    segmentDurationSec: 5,
    finalVideoId: FV,
    replacesJobId: null,
    supersededAt: null,
    userSafeError: null,
    ...overrides,
  });
  const later = new Date(CREATED.getTime() + 60_000);
  const running = toUnifiedLibraryRow(libraryOrder([
    seg(0),
    seg(1),
    seg(0, { id: "redo-1", status: VideoJobStatus.RUNNING, finalVideoId: null, replacesJobId: "seg-0", outputVideoUrl: null, createdAt: later }),
    seg(1, { id: "old-1", finalVideoId: null, supersededAt: CREATED }),
  ]));
  assert.ok(running);
  assert.equal(running.status, "ready", "旧成片照常可看");
  assert.equal(running.failedSceneCount, 0);
  assert.equal(running.redoInFlight, true);
  assert.equal(running.canRestitch, false, "重做在途不能只重拼");
  assert.deepEqual(
    running.segments.map((s) => [s.segmentIndex, s.redo, s.canRedo]),
    [[0, "running", false], [1, "none", false]],
    "旧行不列出",
  );

  const failed = toUnifiedLibraryRow(libraryOrder([
    seg(0),
    seg(1),
    seg(0, { id: "redo-1", status: VideoJobStatus.FAILED, finalVideoId: null, replacesJobId: "seg-0", outputVideoUrl: null, userSafeError: "生成服务拒绝了这段", createdAt: later }),
  ]));
  assert.ok(failed);
  assert.equal(failed.status, "ready");
  assert.equal(failed.failedSceneCount, 0, "失败的候选行不是失败镜头");
  assert.equal(failed.redoInFlight, false);
  assert.equal(failed.canRestitch, true);
  assert.deepEqual(failed.segments[0], {
    segmentIndex: 0,
    durationSec: 5,
    redo: "failed",
    redoJobId: "redo-1",
    redoError: "生成服务拒绝了这段",
    canRedo: true,
  });
});

// ---------------------------------------------------------------------------
// 接线
// ---------------------------------------------------------------------------

test("接线：redoSegment 分支 演示账号拦截 → 参数 → 预检 → 限流 segment-redo → 建行扣费；重拼分支挡住重做在途", async () => {
  const route = await readFile("src/app/api/briefs/[id]/render-retry/route.ts", "utf8");
  const start = route.indexOf("} else if (body.redoSegment !== undefined) {");
  const end = route.indexOf("} else if (body.all === true) {");
  assert.ok(start > 0 && end > start);
  const branch = route.slice(start, end);
  const order = [
    "isDemoAccountEmail(",
    "parseSegmentRedoRequest(",
    "prepareSegmentRedo(",
    'action: "segment-redo"',
    "commitSegmentRedo(",
  ].map((needle) => branch.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), "分支包含全部步骤");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "顺序不能乱");
  assert.match(route, /segmentRedoInFlightWhere\(briefId\)/, "只重拼前检查有没有段在重做");
  assert.match(route, /err instanceof SegmentRedoRejectedError/, "错误码走 #16 的契约码");
  assert.match(route, /selectAllRetryTargets\(rows\)/);

  const quota = await readFile("src/lib/services/quota-service.ts", "utf8");
  assert.match(quota, /"segment-redo": \{\s*envKey: "SEGMENT_REDO_RATE_LIMIT_PER_HOUR"/);

  const panel = await readFile("src/components/library/segment-redo-panel.tsx", "utf8");
  assert.match(panel, /^"use client";/);
  assert.doesNotMatch(panel, /from "@\/lib\/services\//, "客户端面板不引服务端模块");
  assert.doesNotMatch(panel, /from "@\/lib\/video-generation\/segment-redo"/, "说明上限由页面作为 prop 传入");

  const copy = await readFile("src/i18n/platform-copy.ts", "utf8");
  assert.match(copy, /redoHint: "只重新生成你选的这一段，扣 1 段额度。新的一段做好并拼进成片之前，旧成片一直保留/);
});
