import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { ProviderSubmissionError } from "../src/lib/video-generation/providers/submission-error";
import {
  ShuyuPlanUnavailableError,
  parseShuyuCatalog,
  selectAuditedImage2Plan,
  type AuditedShuyuImagePlan,
  type ShuyuAspectRatio,
} from "../src/lib/providers/shuyu-catalog";
import { ShuyuApiError } from "../src/lib/providers/shuyu";
import { isProviderBillingError } from "../src/lib/providers/provider-billing-error";
import {
  ContentPostRenderError,
  RENDER_LOCK_TTL_MS,
} from "../src/lib/services/content-post-render-service";
import {
  __test__ as jobTest,
  cancelContentPostRender,
  cancelUnsubmittedContentPostImages,
  canStartNewContentPostImageAttempt,
  contentPostImageProvider,
  contentPostImageRequestKey,
  pollPendingContentPostRenders,
  reconcileContentPostRender,
  startContentPostRender,
} from "../src/lib/services/content-post-image-job-service";
import {
  buildContentPostRenderView,
  contentPostRenderingWhere,
} from "../src/lib/services/content-post-render-state";
import { awaitingImagesWhere } from "../src/lib/services/exchange-readings";
import { toContentPostLibraryRow } from "../src/lib/services/unified-library-service";
import { createContentPostRenderHandlers } from "../src/app/api/content-plans/[id]/posts/[postId]/render/route";
import * as pollVideosRoute from "../src/app/api/cron/poll-videos/route";
import { ContentPostImageFakeDb, type Row } from "./helpers/content-post-image-fake-db";

/**
 * C2 · 图文帖配图走 Shuyu 异步出图（content-post-image-job-service）。
 *
 * 全部跑在内存版 Prisma（tests/helpers/content-post-image-fake-db.ts）+ 注入的 Shuyu 调用上：
 * 不连数据库、不调真实供应商、零计费。真机验收另见交付说明。
 */

const START = new Date("2026-10-25T12:00:00.000Z");
const SECOND = 1_000;

const PLAN: AuditedShuyuImagePlan = {
  planId: "image-plan-02",
  model: "studio-image",
  resolution: "2K",
  points: 32,
  family: "gpt-image-2",
  aspectRatios: ["2:3", "9:16", "1:1"],
};

function carousel(overrides: Row = {}, slides = 3): Row {
  return {
    id: "post-1",
    planId: "plan-1",
    userId: "user-1",
    ownerDisabledAt: null,
    format: "CAROUSEL",
    status: "DRAFT",
    imagePrompt: null,
    slidesJson: Array.from({ length: slides }, (_, order) => ({ order, imagePrompt: `slide ${order}`, overlayText: null })),
    renderedImageUrls: [],
    renderedAt: null,
    renderError: null,
    renderStartedAt: null,
    renderRunId: null,
    updatedAt: START,
    ...overrides,
  };
}

function singleImage(overrides: Row = {}): Row {
  return carousel({ format: "SINGLE_IMAGE", imagePrompt: "a cosy living room with roller blinds", slidesJson: null, ...overrides });
}

type ProviderResult = { status: "queued" | "processing" | "succeeded" | "failed"; rawStatus: string; outputUrls: string[] };

function install(
  t: TestContext,
  seed: { posts: Row[]; tasks?: Row[]; locking?: boolean },
  options: { resolvePlan?: (input: { resolution: string; aspectRatio: ShuyuAspectRatio }) => Promise<AuditedShuyuImagePlan> } = {},
) {
  const clock = { now: START };
  const fake = new ContentPostImageFakeDb(clock, seed);
  const submits: string[] = [];
  const polls: string[] = [];
  const usage: Array<{ status?: string; outputSummary?: string | null; provider?: string }> = [];
  const provider = new Map<string, ProviderResult>();
  let submitImpl: (requestKey: string) => Promise<string> = async (requestKey) => `ext-${requestKey}`;
  let ids = 0;
  jobTest.setDependencies({
    db: fake.client() as never,
    now: () => new Date(clock.now.getTime()),
    resolvePlan: (options.resolvePlan ?? (async () => PLAN)) as never,
    submitTask: (async (input: { requestKey: string; planSnapshot?: AuditedShuyuImagePlan }) => {
      submits.push(input.requestKey);
      const externalTaskId = await submitImpl(input.requestKey);
      return { requestKey: input.requestKey, externalTaskId, planSnapshot: input.planSnapshot ?? PLAN };
    }) as never,
    pollTask: (async (externalTaskId: string) => {
      polls.push(externalTaskId);
      return provider.get(externalTaskId) ?? { status: "processing", rawStatus: "processing", outputUrls: [] };
    }) as never,
    fetchOutput: (async (url: string) => ({ bytes: Buffer.from(url), mimeType: "image/png" })) as never,
    storage: (() => ({
      isConfigured: () => true,
      uploadBuffer: async (_bucket: string, _bytes: Buffer, opts: { key: string }) => ({
        key: opts.key,
        url: `https://blob.example.test/${opts.key}`,
        absolute: true,
      }),
      deleteObject: async () => undefined,
    })) as never,
    createAsset: (async (input: { url: string; storageKey: string }) => {
      ids += 1;
      return { id: `asset-${ids}`, url: input.url, storageKey: input.storageKey };
    }) as never,
    recordUsage: (async (input: { status?: string; outputSummary?: string | null; provider?: string }) => {
      usage.push(input);
      return {};
    }) as never,
    newId: () => {
      ids += 1;
      return `id-${ids}`;
    },
  });
  t.after(() => jobTest.setDependencies(null));
  const tasksOf = (postId = "post-1") =>
    fake.tasks.filter((task) => task.postId === postId).sort((a, b) => Number(a.slideIndex) - Number(b.slideIndex) || Number(a.attempt) - Number(b.attempt));
  const taskFor = (slideIndex: number, attempt = 1, postId = "post-1") =>
    fake.tasks.find((task) => task.postId === postId && task.slideIndex === slideIndex && task.attempt === attempt)!;
  return {
    fake,
    clock,
    submits,
    polls,
    usage,
    provider,
    tasksOf,
    taskFor,
    setSubmit(impl: (requestKey: string) => Promise<string>) {
      submitImpl = impl;
    },
    later(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    complete(externalTaskId: string) {
      provider.set(externalTaskId, {
        status: "succeeded",
        rawStatus: "completed",
        outputUrls: [`https://shuyu.example.test/${externalTaskId}.png`],
      });
    },
    fail(externalTaskId: string, rawStatus: string) {
      provider.set(externalTaskId, { status: "failed", rawStatus, outputUrls: [] });
    },
  };
}

const ARGS = { userId: "user-1", planId: "plan-1", postId: "post-1" } as const;
const key = (slide: number, attempt = 1, postId = "post-1") => contentPostImageRequestKey(postId, slide, attempt);

function rejectedNoJob(status = 429): ProviderSubmissionError {
  return new ProviderSubmissionError("Shuyu said no", {
    providerId: "shuyu",
    stage: "provider_response",
    httpStatus: status,
    providerConfirmedNoJob: true,
  });
}

function ackUnknown(): ProviderSubmissionError {
  return new ProviderSubmissionError("Shuyu request timed out", { providerId: "shuyu", stage: "transport" });
}

/* ── 开一轮 ───────────────────────────────────────────────────────── */

test("开一轮：每张缺图一个任务（key 格式固定）、最多 3 张在途、限流只计一次、返回每屏状态", async (t) => {
  const h = install(t, { posts: [carousel({ renderedImageUrls: ["https://blob.example.test/old-0.png"] }, 5)] });
  let rateLimited = 0;
  const view = await startContentPostRender({ ...ARGS, beforeRender: async () => { rateLimited += 1; } });

  assert.equal(rateLimited, 1);
  assert.deepEqual(h.tasksOf().map((task) => task.slideIndex), [1, 2, 3, 4], "第 0 屏已有图，不再出");
  assert.deepEqual(h.submits, [key(1), key(2), key(3)], "同一条帖子最多 3 张在途");
  assert.equal(h.taskFor(4).status, "QUEUED");
  assert.match(key(1), /^content-post:post-1:s1:a1$/);
  for (const task of h.tasksOf()) {
    assert.ok(String(task.providerRequestKey).length >= 8 && String(task.providerRequestKey).length <= 120);
    assert.match(String(task.prompt), /no text/i, "提交的是加了禁字尾巴的提示词快照");
    assert.equal(task.aspectRatio, "2:3");
    assert.equal(task.planId, PLAN.planId);
    assert.equal(task.pointsSnapshot, PLAN.points);
  }
  assert.equal(view.state, "rendering");
  assert.equal(view.canStop, true);
  assert.deepEqual(view.slides.map((slide) => slide.state), ["done", "generating", "generating", "generating", "queued"]);
  assert.deepEqual([view.done, view.total], [1, 5]);
  const post = h.fake.post();
  assert.equal(post.status, "DRAFT", "出图中不是新状态：还是草稿 + 渲染锁");
  assert.ok(post.renderStartedAt instanceof Date);
  assert.equal(typeof post.renderRunId, "string");
});

test("🔴 双击 / 两个标签页：只开一轮、每张只提交一次，第二下原样返回进度", async (t) => {
  const h = install(t, { posts: [carousel()] });
  let rateLimited = 0;
  const beforeRender = async () => { rateLimited += 1; };
  const [first, second] = await Promise.all([
    startContentPostRender({ ...ARGS, beforeRender }),
    startContentPostRender({ ...ARGS, beforeRender }),
  ]);
  assert.equal(h.tasksOf().length, 3, "并发两下也只建一套任务");
  assert.deepEqual(h.submits, [key(0), key(1), key(2)]);
  assert.equal(rateLimited, 1, "抢不到锁的那一下不计限流");
  assert.equal(first.state, "rendering");
  assert.equal(second.state, "rendering");

  const again = await startContentPostRender({ ...ARGS, beforeRender });
  assert.equal(again.state, "rendering");
  assert.equal(h.submits.length, 3, "再点一次不重复提交");
  assert.equal(rateLimited, 1);
});

test("🔴 过期的渲染锁：还有没结束的任务就不许接管；没有任务（同步线路进程被杀）才可以", async (t) => {
  const stale = new Date(START.getTime() - RENDER_LOCK_TTL_MS - 60 * SECOND);
  const h = install(t, {
    posts: [
      singleImage({ renderStartedAt: stale, renderRunId: "slow-run" }),
      singleImage({ id: "post-2", renderStartedAt: stale, renderRunId: null }),
    ],
    tasks: [
      {
        id: "task-slow",
        postId: "post-1",
        userId: "user-1",
        renderRunId: "slow-run",
        slideIndex: 0,
        prompt: "p",
        aspectRatio: "2:3",
        status: "PROCESSING",
        submissionState: "ACCEPTED",
        providerRequestKey: key(0),
        externalTaskId: "ext-slow",
        submittedAt: stale,
      },
    ],
  });
  const view = await startContentPostRender(ARGS);
  assert.equal(view.state, "rendering", "Shuyu 排队慢不是锁失效：照常显示出图中");
  assert.equal(h.tasksOf().length, 1, "不新建任务");
  assert.deepEqual(h.submits, [], "不重复提交");
  assert.equal(h.fake.post().renderRunId, "slow-run");

  const takeover = await startContentPostRender({ ...ARGS, postId: "post-2" });
  assert.equal(takeover.state, "rendering");
  assert.deepEqual(h.submits, [key(0, 1, "post-2")]);
  assert.notEqual(h.fake.post("post-2").renderRunId, null);
});

/* ── 对账 / 收尾 ──────────────────────────────────────────────────── */

test("🔴 部分失败：出成的图按位置留下、空位留 \"\"，帖子留在草稿并说人话；「补齐配图」只补缺的那张", async (t) => {
  const h = install(t, { posts: [carousel()] });
  await startContentPostRender(ARGS);
  h.complete(`ext-${key(0)}`);
  h.fail(`ext-${key(1)}`, "refunded");
  h.complete(`ext-${key(2)}`);
  h.later(10 * SECOND);
  const view = await reconcileContentPostRender(ARGS);

  const post = h.fake.post();
  assert.equal(post.status, "DRAFT", "缺一张就不能算可发布");
  const urls = post.renderedImageUrls as string[];
  assert.equal(urls.length, 3);
  assert.match(urls[0]!, /slide-0-attempt-1/);
  assert.equal(urls[1], "", "失败的那屏留空位，后面的图不挪位置");
  assert.match(urls[2]!, /slide-2-attempt-1/);
  assert.equal(post.renderStartedAt, null, "收尾放锁");
  assert.match(String(post.renderError), /第 2 张/);
  assert.match(String(post.renderError), /补齐配图/);
  assert.equal(view.state, "idle");
  assert.deepEqual(view.slides.map((slide) => slide.state), ["done", "failed", "done"]);
  assert.equal(h.taskFor(1).lastProviderStatus, "refunded");
  assert.deepEqual(
    h.usage.map((entry) => entry.status).sort(),
    ["FAILED", "SUCCESS", "SUCCESS"],
    "按张记用量（provider=shuyu，带积分快照）",
  );
  assert.ok(h.usage.every((entry) => entry.provider === "shuyu" && /points=32/.test(String(entry.outputSummary))));

  const retry = await startContentPostRender(ARGS);
  assert.equal(retry.state, "rendering");
  assert.equal(h.submits.at(-1), key(1, 2), "退款确认过的那张开新一次尝试（新 key），其余不动");
  assert.equal(h.submits.length, 4);
  assert.equal(h.taskFor(1, 1).isCurrent, false);
  h.complete(`ext-${key(1, 2)}`);
  h.later(10 * SECOND);
  const done = await reconcileContentPostRender(ARGS);
  assert.equal(done.state, "ready");
  assert.equal(h.fake.post().status, "READY");
  assert.equal(h.fake.post().renderError, null);
});

test("🔴 两张同时出完：锁住帖子行再按位置合并，一张都不丢（关掉行锁的反例会丢）", async (t) => {
  for (const locking of [true, false]) {
    const h = install(t, { posts: [carousel({}, 2)], locking });
    await startContentPostRender(ARGS);
    h.complete(`ext-${key(0)}`);
    h.complete(`ext-${key(1)}`);
    h.later(10 * SECOND);
    await reconcileContentPostRender(ARGS);
    const urls = (h.fake.post().renderedImageUrls as string[]).filter(Boolean);
    if (locking) {
      assert.equal(urls.length, 2, "两张都在");
      assert.equal(h.fake.post().status, "READY");
    } else {
      assert.equal(urls.length, 1, "反例：没有 FOR UPDATE 时并发合并会互相覆盖——证明这条测试真的测到了竞态");
    }
    jobTest.setDependencies(null);
  }
});

test("READY 只走 CAS：收尾时帖子刚被弃用，就不复活成 READY（图照样落库）", async (t) => {
  const h = install(t, { posts: [singleImage()] });
  await startContentPostRender(ARGS);
  h.complete(`ext-${key(0)}`);
  h.later(10 * SECOND);
  h.fake.hooks.push({
    match: (model, op, args) =>
      model === "contentPost" && op === "updateMany" && (args.data as Row | undefined)?.status === "READY",
    before: (store) => {
      store.post().status = "DISCARDED";
    },
  });
  await reconcileContentPostRender(ARGS).catch(() => undefined);
  const post = h.fake.post();
  assert.equal(post.status, "DISCARDED", "只许同一轮的草稿 → READY");
  assert.equal((post.renderedImageUrls as string[]).filter(Boolean).length, 1, "花过钱的图不丢");
  assert.equal(post.renderStartedAt, null);
});

test("READY 只认同一轮：锁已经换了主人（另一轮 / 同步线路），收尾不写 READY、不放别人的锁", async (t) => {
  const h = install(t, { posts: [singleImage()] });
  await startContentPostRender(ARGS);
  h.complete(`ext-${key(0)}`);
  h.later(10 * SECOND);
  const takenAt = new Date(h.clock.now.getTime());
  h.fake.hooks.push({
    match: (model, op, args) =>
      model === "contentPost" && op === "updateMany" && (args.data as Row | undefined)?.status === "READY",
    before: (store) => {
      store.post().renderRunId = null;
      store.post().renderStartedAt = takenAt;
    },
  });
  await reconcileContentPostRender(ARGS);
  const post = h.fake.post();
  assert.equal(post.status, "DRAFT");
  assert.equal(post.renderStartedAt?.valueOf(), takenAt.valueOf(), "别人的锁原样保留");
});

/* ── 停止出图 / 弃用 ──────────────────────────────────────────────── */

test("🔴 停止出图：没提交的当场取消、已提交的照常收回落库，帖子留在草稿、这一轮永远不 READY", async (t) => {
  const h = install(t, { posts: [carousel({}, 5)] });
  await startContentPostRender(ARGS);
  assert.deepEqual(h.submits, [key(0), key(1), key(2)]);

  const stopped = await cancelContentPostRender(ARGS);
  assert.equal(stopped.state, "stopping", "已提交的还在收回");
  assert.equal(stopped.canStop, false);
  assert.equal(stopped.inFlight, 3);
  assert.deepEqual([h.taskFor(3).status, h.taskFor(4).status], ["CANCELLED", "CANCELLED"]);
  assert.match(String(h.fake.post().renderRunId), /^cancelled:/);
  assert.equal(h.fake.post().status, "DRAFT");

  for (const slide of [0, 1, 2]) h.complete(`ext-${key(slide)}`);
  h.later(10 * SECOND);
  const settled = await reconcileContentPostRender(ARGS);
  assert.equal(h.submits.length, 3, "停止之后不再提交任何一张");
  assert.equal((h.fake.post().renderedImageUrls as string[]).filter(Boolean).length, 3, "已提交的三张都收回来了");
  assert.equal(h.fake.post().status, "DRAFT");
  assert.equal(h.fake.post().renderStartedAt, null, "收完放锁");
  assert.match(String(h.fake.post().renderError), /已停止出图/);
  assert.equal(settled.state, "idle");

  const again = await cancelContentPostRender(ARGS);
  assert.equal(again.state, "idle", "重复点停止是幂等的");
});

test("🔴 停止时三张都已在途、之后全部出成：图齐了也不会从这一轮变成 READY", async (t) => {
  const h = install(t, { posts: [carousel()] });
  await startContentPostRender(ARGS);
  await cancelContentPostRender(ARGS);
  for (const slide of [0, 1, 2]) h.complete(`ext-${key(slide)}`);
  h.later(10 * SECOND);
  await reconcileContentPostRender(ARGS);
  assert.equal((h.fake.post().renderedImageUrls as string[]).filter(Boolean).length, 3);
  assert.equal(h.fake.post().status, "DRAFT", "被停止的一轮不复活");
});

test("弃用（DELETE 的服务层）：还没提交的那几张一并取消，已提交的照常收回", async (t) => {
  const h = install(t, { posts: [carousel({}, 4)] });
  await startContentPostRender(ARGS);
  h.fake.post().status = "DISCARDED";
  const cancelled = await cancelUnsubmittedContentPostImages({ userId: "user-1", postId: "post-1" });
  assert.equal(cancelled, 1);
  assert.equal(h.taskFor(3).status, "CANCELLED");
  h.complete(`ext-${key(0)}`);
  h.later(10 * SECOND);
  await reconcileContentPostRender(ARGS);
  assert.equal((h.fake.post().renderedImageUrls as string[]).filter(Boolean).length, 1);
  assert.equal(h.fake.post().status, "DISCARDED");
});

/* ── 提交失败分类 ─────────────────────────────────────────────────── */

test("🔴 Shuyu 明确没建任务（429）：同一个 key 退避自动重投，最多 3 次，之后停下等商家", async (t) => {
  const h = install(t, { posts: [singleImage()] });
  h.setSubmit(async () => { throw rejectedNoJob(429); });
  const view = await startContentPostRender(ARGS);
  const task = h.taskFor(0);
  assert.equal(view.state, "rendering", "等自动重投期间仍是出图中");
  assert.deepEqual([task.status, task.submissionState, task.errorCode], ["QUEUED", "REJECTED", "PROVIDER_REJECTED_RETRYING"]);
  assert.equal((task.availableAt as Date).getTime() - h.clock.now.getTime(), jobTest.RESUBMIT_BACKOFF_MS[0]);

  h.later(5 * SECOND);
  await reconcileContentPostRender(ARGS);
  assert.equal(h.submits.length, 1, "退避没到不重投");

  for (const wait of jobTest.RESUBMIT_BACKOFF_MS) {
    h.later(wait + SECOND);
    await reconcileContentPostRender(ARGS);
  }
  assert.equal(h.submits.length, 4, "首投 + 3 次自动重投");
  assert.ok(h.submits.every((submitted) => submitted === key(0)), "重投复用同一个 Idempotency-Key");
  assert.deepEqual([h.taskFor(0).status, h.taskFor(0).errorCode], ["FAILED", "PROVIDER_REJECTED"]);
  assert.equal(h.fake.post().renderStartedAt, null);
  assert.match(String(h.fake.post().renderError), /补齐配图/);

  h.setSubmit(async (requestKey) => `ext-${requestKey}`);
  await startContentPostRender(ARGS);
  assert.equal(h.submits.at(-1), key(0, 2), "没建过任务的那张可以开新一次尝试");
});

test("🔴 回执未知且没有任务号：自动换新 key 重投一次（再未知就停下）；任务号已知则只对账不重投", async (t) => {
  const h = install(t, { posts: [singleImage(), singleImage({ id: "post-2" })] });
  h.setSubmit(async () => { throw ackUnknown(); });
  const first = await startContentPostRender(ARGS);
  assert.equal(h.taskFor(0).submissionState, "ACK_UNKNOWN");
  assert.equal(h.taskFor(0).status, "FAILED");
  assert.equal(first.state, "rendering", "还欠一次自动重投，不收尾");

  await reconcileContentPostRender(ARGS);
  assert.equal(h.taskFor(0, 2).status, "QUEUED", "新建第 2 次尝试");
  assert.equal(h.submits.length, 1, "新尝试稍等片刻再提交");
  h.later(25 * SECOND);
  await reconcileContentPostRender(ARGS);
  assert.deepEqual(h.submits, [key(0, 1), key(0, 2)]);
  assert.equal(h.taskFor(0, 2).submissionState, "ACK_UNKNOWN");
  h.later(25 * SECOND);
  await reconcileContentPostRender(ARGS);
  assert.equal(h.submits.length, 2, "同一轮只自动重投一次");
  assert.equal(h.fake.post().renderStartedAt, null, "停下来收尾");
  assert.equal(h.fake.post().status, "DRAFT");

  /// 任务号已知、只是落库失败：按 ACK_UNKNOWN 记下任务号继续对账，成了就收图。
  h.setSubmit(async (requestKey) => `ext-${requestKey}`);
  const acceptFailures = 2;
  for (let index = 0; index < acceptFailures; index += 1) {
    h.fake.hooks.push({
      match: (model, op, args) =>
        model === "contentPostImageTask" &&
        op === "updateMany" &&
        (args.data as Row | undefined)?.submissionState === "ACCEPTED",
      error: new Error("connection reset"),
    });
  }
  await startContentPostRender({ ...ARGS, postId: "post-2" });
  const known = h.taskFor(0, 1, "post-2");
  assert.deepEqual([known.status, known.submissionState, known.externalTaskId], ["PROCESSING", "ACK_UNKNOWN", `ext-${key(0, 1, "post-2")}`]);
  h.complete(`ext-${key(0, 1, "post-2")}`);
  h.later(10 * SECOND);
  await reconcileContentPostRender({ ...ARGS, postId: "post-2" });
  assert.equal(h.fake.post("post-2").status, "READY");
  assert.equal(h.submits.filter((submitted) => submitted.includes("post-2")).length, 1, "任务号已知绝不重投");
});

test("卡在「提交中」超过 2 分钟（进程半途没了）：按回执未知终结，再走一次自动重投", async (t) => {
  const h = install(t, { posts: [singleImage()] });
  let reachedProvider!: () => void;
  const submitting = new Promise<void>((resolve) => {
    reachedProvider = resolve;
  });
  /// 提交请求发出去后永远不回（进程在这一刻没了）。
  h.setSubmit(() => {
    reachedProvider();
    return new Promise<string>(() => undefined);
  });
  void startContentPostRender(ARGS);
  await submitting;
  assert.equal(h.taskFor(0).submissionState, "SUBMITTING");
  h.setSubmit(async (requestKey) => `ext-${requestKey}`);
  h.later(3 * 60 * SECOND);
  await reconcileContentPostRender(ARGS);
  assert.equal(h.taskFor(0, 1).submissionState, "ACK_UNKNOWN");
  assert.equal(h.taskFor(0, 2).status, "QUEUED", "无任务号：新 attempt 自动重投一次");
});

test("🔴 账户层故障（Shuyu 402 积分不足）：说「服务暂时不可用」，同一轮没提交的几张不再提交", async (t) => {
  const h = install(t, { posts: [carousel({}, 5)] });
  h.setSubmit(async () => { throw rejectedNoJob(402); });
  const view = await startContentPostRender(ARGS);
  assert.equal(h.submits.length, 3, "只有已经在途的三张碰到了 402");
  assert.deepEqual(
    h.tasksOf().map((task) => [task.status, task.errorCode]),
    Array.from({ length: 5 }, () => ["FAILED", "PROVIDER_UNAVAILABLE"]),
  );
  assert.equal(view.state, "idle");
  assert.match(String(h.fake.post().renderError), /配图服务暂时不可用/);
  assert.equal(h.fake.post().renderStartedAt, null);
});

test("套餐刚被下线（400 model_unavailable）：不按同一份快照白白重投，同一轮停下、说清楚过几分钟再补", async (t) => {
  const h = install(t, { posts: [carousel({}, 4)] });
  h.setSubmit(async () => {
    throw new ProviderSubmissionError("model unavailable", {
      providerId: "shuyu",
      stage: "provider_response",
      httpStatus: 400,
      code: "model_unavailable",
      providerConfirmedNoJob: true,
    });
  });
  await startContentPostRender(ARGS);
  assert.equal(h.submits.length, 3, "只有在途的三张碰到了拒绝，没有自动重投");
  assert.ok(h.tasksOf().every((task) => task.errorCode === "PLAN_WITHDRAWN" && task.status === "FAILED"));
  assert.match(String(h.fake.post().renderError), /调整了出图套餐/);
  assert.equal(h.fake.post().renderStartedAt, null);
  h.setSubmit(async (requestKey) => `ext-${requestKey}`);
  await startContentPostRender(ARGS);
  assert.equal(h.submits.at(-1), key(2, 2), "没扣费的那几张可以按新一轮重出");
});

test("账户层错误识别：Shuyu 401/402/403、积分不足、没配 key 都算；普通限流 / 超时不算", () => {
  assert.equal(isProviderBillingError(new ShuyuApiError("Shuyu balance request failed (402)", "insufficient_balance", 402)), true);
  assert.equal(isProviderBillingError(new ShuyuApiError("bad key", "authentication_rejected", 401)), true);
  assert.equal(isProviderBillingError(new ShuyuApiError("Shuyu API key is not configured", "not_configured")), true);
  assert.equal(isProviderBillingError(rejectedNoJob(402)), true);
  assert.equal(isProviderBillingError(rejectedNoJob(403)), true);
  assert.equal(isProviderBillingError({ message: "提交被拒绝: 积分不足，请充值" }), true);
  assert.equal(isProviderBillingError(rejectedNoJob(429)), false);
  assert.equal(isProviderBillingError(new ShuyuApiError("Shuyu request timed out", "timeout")), false);
});

test("开轮前解析套餐失败：账户 / 套餐问题回「暂不可用」，什么都不锁、不建任务", async (t) => {
  const h = install(t, { posts: [singleImage()] }, {
    resolvePlan: async () => { throw new ShuyuApiError("bad key", "authentication_rejected", 401); },
  });
  await assert.rejects(
    startContentPostRender(ARGS),
    (error: unknown) => error instanceof ContentPostRenderError && error.reason === "provider_unavailable",
  );
  assert.equal(h.fake.post().renderStartedAt, null);
  assert.equal(h.tasksOf().length, 0);
});

test("退款没确认的失败不自动重出：缺的只剩这种就回 billing_review（人工核对），不花钱", async (t) => {
  const h = install(t, {
    posts: [singleImage()],
    tasks: [
      {
        id: "task-failed",
        postId: "post-1",
        userId: "user-1",
        renderRunId: "old",
        slideIndex: 0,
        prompt: "p",
        aspectRatio: "2:3",
        status: "FAILED",
        submissionState: "ACCEPTED",
        providerRequestKey: key(0),
        externalTaskId: "ext-old",
        lastProviderStatus: "failed",
      },
    ],
  });
  await assert.rejects(
    startContentPostRender(ARGS),
    (error: unknown) => error instanceof ContentPostRenderError && error.reason === "billing_review",
  );
  assert.deepEqual(h.submits, []);
  assert.equal(canStartNewContentPostImageAttempt({ status: "FAILED", externalTaskId: "x", lastProviderStatus: "refunded" } as never), true);
  assert.equal(canStartNewContentPostImageAttempt({ status: "FAILED", externalTaskId: "x", lastProviderStatus: "refund_error" } as never), false);
  assert.equal(canStartNewContentPostImageAttempt({ status: "FAILED", externalTaskId: null, lastProviderStatus: null } as never), true);
  assert.equal(canStartNewContentPostImageAttempt({ status: "PROCESSING", externalTaskId: "x", lastProviderStatus: null } as never), false);
});

test("提交后半小时还没终态：停止等待、不自动重出（退款未知），这一轮照样收尾放锁", async (t) => {
  const submittedAt = new Date(START.getTime() - 31 * 60 * SECOND);
  const h = install(t, {
    posts: [singleImage({ renderStartedAt: submittedAt, renderRunId: "run-1" })],
    tasks: [
      {
        id: "task-stuck",
        postId: "post-1",
        userId: "user-1",
        renderRunId: "run-1",
        slideIndex: 0,
        prompt: "p",
        aspectRatio: "2:3",
        status: "PROCESSING",
        submissionState: "ACCEPTED",
        providerRequestKey: key(0),
        externalTaskId: "ext-stuck",
        submittedAt,
      },
    ],
  });
  const view = await reconcileContentPostRender(ARGS);
  assert.deepEqual([h.fake.task("task-stuck").status, h.fake.task("task-stuck").errorCode], ["FAILED", "PROVIDER_TIMEOUT"]);
  assert.deepEqual(h.polls, ["ext-stuck"], "先问供应商：还在生成才判超时");
  assert.equal(view.state, "idle");
  assert.match(String(h.fake.post().renderError), /联系我们核对/);
  await assert.rejects(
    startContentPostRender(ARGS),
    (error: unknown) => error instanceof ContentPostRenderError && error.reason === "billing_review",
    "有任务号、没确认退款：不自动开新的计费尝试",
  );
});

test("🔴 超时边上刚出完的图照样收回（先问供应商再判超时，花过钱的图不丢）", async (t) => {
  const submittedAt = new Date(START.getTime() - 31 * 60 * SECOND);
  const h = install(t, {
    posts: [singleImage({ renderStartedAt: submittedAt, renderRunId: "run-1" })],
    tasks: [
      {
        id: "task-late",
        postId: "post-1",
        userId: "user-1",
        renderRunId: "run-1",
        slideIndex: 0,
        prompt: "p",
        aspectRatio: "2:3",
        status: "PROCESSING",
        submissionState: "ACCEPTED",
        providerRequestKey: key(0),
        externalTaskId: "ext-late",
        submittedAt,
      },
    ],
  });
  h.complete("ext-late");
  const view = await reconcileContentPostRender(ARGS);
  assert.equal(h.fake.task("task-late").status, "SUCCEEDED");
  assert.equal(view.state, "ready");
});

test("账号已停用：排队的那几张不再提交（取消、不计费），已提交的照常收回", async (t) => {
  const h = install(t, { posts: [carousel({}, 4)] });
  await startContentPostRender(ARGS);
  h.fake.post().ownerDisabledAt = new Date(START.getTime());
  h.complete(`ext-${key(0)}`);
  h.later(10 * SECOND);
  await pollPendingContentPostRenders(20);
  assert.equal(h.taskFor(3).status, "CANCELLED");
  assert.match(String(h.taskFor(3).errorMessage), /账号已停用/);
  assert.equal(h.submits.length, 3);
  assert.equal((h.fake.post().renderedImageUrls as string[]).filter(Boolean).length, 1, "已提交的照样收回");
});

/* ── 套餐画幅 ─────────────────────────────────────────────────────── */

function pricePlan(planId: string, resolution: string, points: number, ratios?: string[]) {
  return {
    plan_id: planId,
    kind: "image",
    model: "studio-image",
    unit: "generation",
    resolution,
    sale_points: points,
    display_name: `GPT Image 2 · ${resolution}`,
    ...(ratios ? { capabilities: { aspect_ratios: ratios, input_images_max: 5 } } : {}),
    status: "available",
  };
}

test("套餐按画幅筛：只在声明支持 2:3 的档位里选（1K 下线自动升档）；不传画幅时行为不变", () => {
  const catalog = parseShuyuCatalog({
    object: "list",
    data: [
      pricePlan("image-plan-08", "2K", 28, ["9:16", "1:1", "16:9"]),
      pricePlan("image-plan-05", "2K", 32, ["2:3", "9:16"]),
      pricePlan("image-plan-09", "4K", 44, ["2:3"]),
      pricePlan("image-plan-10", "2K", 20),
    ],
  });
  assert.deepEqual(catalog.imagePlans.find((plan) => plan.planId === "image-plan-05")?.aspectRatios, ["2:3", "9:16"]);
  assert.deepEqual(catalog.imagePlans.find((plan) => plan.planId === "image-plan-10")?.aspectRatios, [], "没声明画幅 = 空（按画幅筛选时不选它）");
  assert.equal(selectAuditedImage2Plan(catalog, "1K", { aspectRatio: "2:3" }).planId, "image-plan-05", "便宜的 08 不支持 2:3，不能选");
  assert.equal(selectAuditedImage2Plan(catalog, "1K").planId, "image-plan-10", "不按画幅筛时与既有行为一致");
  assert.throws(() => selectAuditedImage2Plan(catalog, "1K", { aspectRatio: "3:2" }), ShuyuPlanUnavailableError);
});

test("目录里没有 2:3：退到最接近的竖版画幅（写进任务行）；连竖版都没有就说暂不可用", async (t) => {
  const catalogFor = (ratios: string[]) =>
    parseShuyuCatalog({ object: "list", data: [pricePlan("image-plan-02", "2K", 32, ratios)] });
  const resolverFor = (ratios: string[]) => async (input: { resolution: string; aspectRatio: ShuyuAspectRatio }) =>
    selectAuditedImage2Plan(catalogFor(ratios), "1K", { aspectRatio: input.aspectRatio });

  const h = install(t, { posts: [singleImage()] }, { resolvePlan: resolverFor(["9:16", "3:4", "1:1"]) });
  await startContentPostRender(ARGS);
  assert.equal(h.taskFor(0).aspectRatio, "3:4");
  jobTest.setDependencies(null);

  const landscapeOnly = install(t, { posts: [singleImage()] }, { resolvePlan: resolverFor(["16:9", "1:1"]) });
  await assert.rejects(
    startContentPostRender(ARGS),
    (error: unknown) => error instanceof ContentPostRenderError && error.reason === "provider_unavailable",
  );
  assert.equal(landscapeOnly.tasksOf().length, 0);
});

/* ── cron / 读数 / 成品库 / 视图 ──────────────────────────────────── */

test("cron 轮询：推进有在途任务的帖子，也给「任务都终态、锁没放」的一轮收尾", async (t) => {
  const h = install(t, {
    posts: [
      singleImage(),
      singleImage({ id: "post-2", renderStartedAt: new Date(START.getTime() - 5 * 60 * SECOND), renderRunId: "run-2" }),
    ],
    tasks: [
      {
        id: "task-2",
        postId: "post-2",
        userId: "user-1",
        renderRunId: "run-2",
        slideIndex: 0,
        prompt: "p",
        aspectRatio: "2:3",
        status: "FAILED",
        submissionState: "REJECTED",
        providerRequestKey: key(0, 1, "post-2"),
        errorCode: "PROVIDER_REJECTED",
      },
    ],
  });
  await startContentPostRender(ARGS);
  h.complete(`ext-${key(0)}`);
  h.later(10 * SECOND);
  const advanced = await pollPendingContentPostRenders(20);
  assert.equal(advanced, 2);
  assert.equal(h.fake.post().status, "READY", "商家关了页面，cron 照样收图收尾");
  assert.equal(h.fake.post("post-2").renderStartedAt, null, "卡住的锁被收尾放掉");
  assert.match(String(h.fake.post("post-2").renderError), /补齐配图/);
});

test("cron 路由把图文出图轮询放进同一个 allSettled（注入式依赖）", async () => {
  const calls: Array<[string, number]> = [];
  const handler = pollVideosRoute.createPollVideosHandler({
    machineAuthFailure: () => null,
    startSchedulerHeartbeat: (() => ({ finish: (status: string) => ({ status }) })) as never,
    pollRunningJobs: async () => ({ polled: 0, updated: 0 }) as never,
    pollPendingProductImageJobs: async () => ({ polled: 0, recovered: 0 }) as never,
    pollPendingStoryboardRuns: async () => 0 as never,
    pollPendingContentPostRenders: async (limit?: number) => {
      calls.push(["content-post", limit ?? -1]);
      return 4;
    },
    sweepStuckTasks: async () => ({}) as never,
  });
  const response = await handler(new NextRequest("http://localhost/api/cron/poll-videos"));
  const body = (await response.json()) as { contentPostPolled?: number; degraded?: boolean };
  assert.deepEqual(calls, [["content-post", 20]]);
  assert.equal(body.contentPostPolled, 4);
  assert.equal(body.degraded, false);
});

test("「待出图」读数排除正在出图的帖子（与本周内容 / 成品库同一口径）", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  const where = awaitingImagesWhere("user-1", now);
  assert.deepEqual(where.NOT, contentPostRenderingWhere(now));
  assert.deepEqual(where.renderedImageUrls, { isEmpty: true });
  const registry = readFileSync("src/lib/exchange/readings-registry.ts", "utf8");
  assert.match(registry, /awaitingImages: def\("待出图", "Awaiting images", "排好、还没出图、也不在出图中的图文帖"/);
});

test("成品库：正在出图的图文帖是「生成中」+ 按张数的进度；轮播的空位不进图片列表、不丢行", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  const base = {
    id: "p1",
    key: "k1",
    format: "CAROUSEL",
    status: "DRAFT",
    copyHook: "钩子",
    imagePrompt: null,
    slidesJson: [{ order: 0, imagePrompt: "a" }, { order: 1, imagePrompt: "b" }, { order: 2, imagePrompt: "c" }, { order: 3, imagePrompt: "d" }],
    renderedImageUrls: ["https://cdn.example.com/0.png", "", "https://cdn.example.com/2.png"],
    renderStartedAt: new Date(now.getTime() - 30 * 60 * SECOND),
    updatedAt: now,
    plan: { id: "plan1", theme: "主题" },
    _count: { imageTasks: 1 },
  };
  const rendering = toContentPostLibraryRow(base as never, false, now)!;
  assert.equal(rendering.status, "generating", "锁再旧，只要还有任务在跑就是生成中");
  assert.equal(rendering.progress, 50);
  assert.deepEqual(rendering.imageUrls, ["https://cdn.example.com/0.png", "https://cdn.example.com/2.png"]);
  const idle = toContentPostLibraryRow({ ...base, _count: { imageTasks: 0 } } as never, false, now)!;
  assert.equal(idle.status, "ready", "不在出图时沿用既有口径（有图即进成片区）");
  const page = readFileSync("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(page, /const renderingPostRows = rows\.filter\(\(row\) => isPost\(row\) && row\.status === "generating"\)/);
  assert.match(page, /<PostRenderWatcher/);
});

test("视图：出图中 / 停止收回中 / 空闲 / 已可发布，每屏状态按位置给", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  const post = {
    id: "post-1",
    status: "DRAFT" as const,
    format: "CAROUSEL",
    imagePrompt: null,
    slidesJson: [{ order: 0, imagePrompt: "a" }, { order: 1, imagePrompt: "b" }, { order: 2, imagePrompt: "c" }],
    renderedImageUrls: ["https://cdn.example.com/0.png"],
    renderError: null,
    renderStartedAt: now,
    renderRunId: "run-1",
  };
  const tasks = [
    { slideIndex: 0, attempt: 1, isCurrent: true, status: "SUCCEEDED", errorMessage: null },
    { slideIndex: 1, attempt: 1, isCurrent: true, status: "PROCESSING", errorMessage: null },
    { slideIndex: 2, attempt: 1, isCurrent: false, status: "FAILED", errorMessage: "old" },
    { slideIndex: 2, attempt: 2, isCurrent: true, status: "CANCELLED", errorMessage: "停了" },
  ];
  const view = buildContentPostRenderView({ post, tasks, now });
  assert.equal(view.state, "rendering");
  assert.deepEqual(view.slides.map((slide) => [slide.state, slide.note]), [["done", null], ["generating", null], ["cancelled", "停了"]]);
  assert.deepEqual([view.done, view.total, view.inFlight, view.canStop], [1, 3, 1, true]);
  assert.equal(buildContentPostRenderView({ post: { ...post, renderRunId: "cancelled:run-1" }, tasks, now }).state, "stopping");
  assert.equal(buildContentPostRenderView({ post: { ...post, renderStartedAt: null }, tasks: [], now }).state, "idle");
  assert.equal(buildContentPostRenderView({ post: { ...post, status: "READY", renderStartedAt: null }, tasks: [], now }).state, "ready");
});

/* ── 路由：演示账号 / 线路开关 ───────────────────────────────────── */

function routeContext() {
  return { params: Promise.resolve({ id: "plan-1", postId: "post-1" }) };
}

function authed(email: string) {
  return async () => ({ ok: true as const, session: { user: { id: "user-1", email } } as never });
}

const SAMPLE_VIEW = {
  postId: "post-1",
  status: "DRAFT" as const,
  state: "rendering" as const,
  total: 1,
  done: 0,
  inFlight: 1,
  renderedImageUrls: [],
  renderError: null,
  slides: [{ index: 0, state: "generating" as const, imageUrl: null, note: null }],
  canStop: true,
};

test("🔴 演示账号不跑付费出图：POST 直接 403，服务层一次都不调", async () => {
  const calls: string[] = [];
  const handlers = createContentPostRenderHandlers({
    requireAuth: authed("demo@aivora.app"),
    startContentPostRender: async () => { calls.push("start"); return SAMPLE_VIEW; },
    renderContentPost: async () => { calls.push("openai"); return { urls: [], skipped: true }; },
  });
  const response = await handlers.POST(new NextRequest("http://localhost/x", { method: "POST" }), routeContext());
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { code?: string }).code, "DEMO_BLOCKED");
  assert.deepEqual(calls, []);
});

test("线路开关：默认 Shuyu 异步（202 + state + slides）；CONTENT_POST_IMAGE_PROVIDER=openai 走原同步线路", async () => {
  assert.equal(contentPostImageProvider({}), "shuyu");
  assert.equal(contentPostImageProvider({ CONTENT_POST_IMAGE_PROVIDER: " OpenAI " }), "openai");
  assert.equal(contentPostImageProvider({ CONTENT_POST_IMAGE_PROVIDER: "bogus" }), "shuyu");

  const calls: Array<{ via: string; args: unknown }> = [];
  const shuyu = createContentPostRenderHandlers({
    requireAuth: authed("merchant@example.com"),
    imageProvider: () => "shuyu",
    assertPaidActionRateLimit: async () => undefined,
    startContentPostRender: async (args) => {
      calls.push({ via: "shuyu", args: { planId: args.planId, postId: args.postId, userId: args.userId } });
      await args.beforeRender?.();
      return SAMPLE_VIEW;
    },
    renderContentPost: async () => { calls.push({ via: "openai", args: null }); return { urls: [], skipped: false }; },
  });
  const accepted = await shuyu.POST(new NextRequest("http://localhost/x", { method: "POST" }), routeContext());
  assert.equal(accepted.status, 202);
  const body = (await accepted.json()) as { state: string; slides: unknown[] };
  assert.equal(body.state, "rendering");
  assert.equal(body.slides.length, 1);
  assert.deepEqual(calls, [{ via: "shuyu", args: { planId: "plan-1", postId: "post-1", userId: "user-1" } }]);

  const syncCalls: Array<{ via: string; args: unknown }> = [];
  const openai = createContentPostRenderHandlers({
    requireAuth: authed("merchant@example.com"),
    imageProvider: () => "openai",
    startContentPostRender: async () => { syncCalls.push({ via: "shuyu", args: null }); return SAMPLE_VIEW; },
    renderContentPost: async (args) => {
      syncCalls.push({ via: "openai", args: args.postId });
      return { urls: ["https://blob.example.test/a.png"], skipped: false };
    },
  });
  const sync = await openai.POST(new NextRequest("http://localhost/x", { method: "POST" }), routeContext());
  assert.equal(sync.status, 200);
  assert.deepEqual(await sync.json(), { urls: ["https://blob.example.test/a.png"], skipped: false });
  assert.deepEqual(syncCalls, [{ via: "openai", args: "post-1" }]);
});

test("路由：GET 读时对账；DELETE 弃用后一并取消没提交的；退款未确认回 409 + 联系我们", async () => {
  const calls: string[] = [];
  const handlers = createContentPostRenderHandlers({
    requireAuth: authed("merchant@example.com"),
    reconcileContentPostRender: async () => { calls.push("reconcile"); return SAMPLE_VIEW; },
    discardContentPost: async () => { calls.push("discard"); return true; },
    cancelUnsubmittedContentPostImages: async () => { calls.push("cancel-unsubmitted"); return 2; },
    imageProvider: () => "shuyu",
    assertPaidActionRateLimit: async () => undefined,
    startContentPostRender: async () => {
      throw new ContentPostRenderError("退款未确认", "billing_review");
    },
  });
  const read = await handlers.GET(new NextRequest("http://localhost/x"), routeContext());
  assert.equal(read.status, 200);
  assert.equal(((await read.json()) as { state: string }).state, "rendering");
  const removed = await handlers.DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), routeContext());
  assert.equal(removed.status, 200);
  assert.deepEqual(calls, ["reconcile", "discard", "cancel-unsubmitted"]);
  const held = await handlers.POST(new NextRequest("http://localhost/x", { method: "POST" }), routeContext());
  assert.equal(held.status, 409);
  const heldBody = (await held.json()) as { action: string; retryable: boolean };
  assert.deepEqual([heldBody.action, heldBody.retryable], ["contact_support", false]);
});

test("回滚线路的同步出图拿锁时让出给异步线路：有没结束的任务不接管，并清掉轮次号", () => {
  const legacy = readFileSync("src/lib/services/content-post-render-service.ts", "utf8");
  const lock = legacy.slice(legacy.indexOf("const lock = await db.contentPost.updateMany"));
  assert.match(lock.slice(0, 900), /imageTasks: \{ none: \{ status: \{ in: \["QUEUED", "PROCESSING"\] \} \} \}/);
  assert.match(lock.slice(0, 900), /data: \{ renderStartedAt: lockedAt, renderRunId: null \}/);
});

test("本周内容（client 组件）只拿纯契约，不引任何服务端 service", () => {
  for (const file of [
    "src/components/content-plan/plan-timeline.tsx",
    "src/components/library/post-render-watcher.tsx",
    "src/components/library/render-pending-posts-button.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /^"use client";/);
    assert.doesNotMatch(source, /from "@\/lib\/services\//, `${file} 不得 import 服务端 service`);
  }
  const timeline = readFileSync("src/components/content-plan/plan-timeline.tsx", "utf8");
  assert.match(timeline, /key=\{slot\.index\}/, "画框按屏序号做 key（空位是 \"\"，按 URL 会撞 key）");
  assert.match(timeline, /window\.setTimeout\(poll, RENDER_POLL_MS\)/);
  assert.match(timeline, /visibilitychange/);
});
