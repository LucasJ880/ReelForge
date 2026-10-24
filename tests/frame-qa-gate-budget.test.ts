/**
 * D2 帧质检门禁（4.3）：结果落库、cron 预算上下文、拦截后免费重抽上限。
 *
 * 全部通过依赖注入：不跑 ffmpeg、不调 vision、不连数据库。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { VideoProvider } from "@prisma/client";
import {
  CRON_FRAME_QA_BUDGET,
  FRAME_QA_BLOCK_USER_ERROR,
  FRAME_QA_FREE_RETRY_CAP,
  FRAME_QA_STATUS,
  __test__ as gateTest,
  decideFrameQaGate,
  decideFromVerdict,
  frameQaBudgetUsage,
  readFrameQaBlockCount,
  runWithFrameQaBudget,
  type FrameQaGateDeps,
} from "../src/lib/services/frame-qa-gate";
import { FRAME_QA_ERROR_PREFIX, type FrameQaVerdict } from "../src/lib/video-generation/frame-qa";

const ENV_KEYS = ["FRAME_QA_OUTSIDE_BUDGET", "NODE_ENV"] as const;
let envBackup: Record<string, string | undefined> = {};
beforeEach(() => {
  envBackup = {};
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];
});
afterEach(() => {
  const env = process.env as Record<string, string | undefined>;
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete env[k];
    else env[k] = envBackup[k];
  }
});

const NOW = new Date("2026-10-25T08:00:00.000Z");

const PASS_VERDICT: FrameQaVerdict = {
  ok: true,
  checked: true,
  frameCount: 6,
  issues: [],
  summary: "帧质检通过（6 帧无画面文字）",
  shadow: {
    v: 1,
    blackBars: null,
    nearStatic: {
      detected: false,
      frozenSec: 0,
      durationSec: 15,
      ratio: 0,
      threshold: 0.5,
      noiseDb: -50,
      minFreezeSec: 1,
    },
  },
};

const BLOCK_VERDICT: FrameQaVerdict = {
  ok: false,
  checked: true,
  frameCount: 6,
  issues: [{ frameIndex: 3, detail: "检测到画面叠加文字「又被曬醒了」" }],
  summary: "帧质检拦截：第4帧 检测到画面叠加文字「又被曬醒了」",
};

const SKIP_VERDICT: FrameQaVerdict = {
  ok: true,
  checked: false,
  skipReason: "门禁超时（>45s）",
  frameCount: 0,
  issues: [],
  summary: "帧质检跳过：门禁超时（>45s）",
};

function deps(overrides: Partial<FrameQaGateDeps> = {}) {
  const calls = { qa: 0, load: 0 };
  const d: FrameQaGateDeps = {
    isFrameQaEnabled: () => true,
    runFrameTextQa: async () => {
      calls.qa += 1;
      return PASS_VERDICT;
    },
    loadPriorDetail: async () => {
      calls.load += 1;
      return null;
    },
    now: () => NOW,
    ...overrides,
  };
  return { d, calls };
}

function detailOf(data: Record<string, unknown>) {
  return data.frameQaDetail as Record<string, unknown>;
}

test("[frame-qa-gate] 通过 → PASSED 落库（状态 / 时间 / 详情含影子检查）", () => {
  const decision = decideFromVerdict({
    verdict: PASS_VERDICT,
    priorBlockCount: 0,
    checkedAt: NOW,
    budget: "cron:poll-videos",
  });
  assert.equal(decision.action, "pass");
  if (decision.action !== "pass") return;
  assert.equal(decision.successData.frameQaStatus, FRAME_QA_STATUS.PASSED);
  assert.deepEqual(decision.successData.frameQaCheckedAt, NOW);
  const detail = detailOf(decision.successData as Record<string, unknown>);
  assert.equal(detail.status, "PASSED");
  assert.equal(detail.checked, true);
  assert.equal(detail.blockCount, 0);
  assert.equal(detail.budget, "cron:poll-videos");
  assert.ok(detail.shadow, "影子检查结果要随详情落库");
});

test("[frame-qa-gate] 检出文字 → BLOCKED，errorMessage 保持重试识别前缀，累计次数 +1", () => {
  const decision = decideFromVerdict({ verdict: BLOCK_VERDICT, priorBlockCount: 0, checkedAt: NOW });
  assert.equal(decision.action, "block");
  if (decision.action !== "block") return;
  const data = decision.failureData as Record<string, unknown>;
  assert.ok(String(data.errorMessage).startsWith(FRAME_QA_ERROR_PREFIX));
  assert.equal(data.userSafeError, FRAME_QA_BLOCK_USER_ERROR);
  assert.equal(data.frameQaStatus, "BLOCKED");
  assert.equal(detailOf(data).blockCount, 1);
});

test("[frame-qa-gate] 免费重抽上限：第 2 次仍拦截，第 3 次检出改 WOULD_BLOCK 放行并告警", () => {
  assert.equal(FRAME_QA_FREE_RETRY_CAP, 2);
  const second = decideFromVerdict({ verdict: BLOCK_VERDICT, priorBlockCount: 1, checkedAt: NOW });
  assert.equal(second.action, "block");
  if (second.action === "block") {
    assert.equal(detailOf(second.failureData as Record<string, unknown>).blockCount, 2);
  }

  const third = decideFromVerdict({ verdict: BLOCK_VERDICT, priorBlockCount: 2, checkedAt: NOW });
  assert.equal(third.action, "pass", "用满上限后不能再无限付费重抽");
  if (third.action !== "pass") return;
  assert.equal(third.successData.frameQaStatus, FRAME_QA_STATUS.WOULD_BLOCK);
  const detail = detailOf(third.successData as Record<string, unknown>);
  assert.equal(detail.blockCount, 2);
  assert.match(String(detail.warning), /免费重抽上限 2 次/);
  assert.equal((detail.issues as unknown[]).length, 1, "本该拦截的问题帧原样留档");
});

test("[frame-qa-gate] 门禁自身失败（超时 / vision 异常）→ SKIPPED 落库并保留历史拦截次数", () => {
  const decision = decideFromVerdict({ verdict: SKIP_VERDICT, priorBlockCount: 1, checkedAt: NOW });
  assert.equal(decision.action, "pass");
  if (decision.action !== "pass") return;
  assert.equal(decision.successData.frameQaStatus, FRAME_QA_STATUS.SKIPPED);
  const detail = detailOf(decision.successData as Record<string, unknown>);
  assert.equal(detail.skipReason, "门禁超时（>45s）");
  assert.equal(detail.blockCount, 1);
});

test("[frame-qa-gate] readFrameQaBlockCount 容忍坏数据", () => {
  assert.equal(readFrameQaBlockCount(null), 0);
  assert.equal(readFrameQaBlockCount("x"), 0);
  assert.equal(readFrameQaBlockCount([1]), 0);
  assert.equal(readFrameQaBlockCount({ blockCount: -1 }), 0);
  assert.equal(readFrameQaBlockCount({ blockCount: 1.5 }), 0);
  assert.equal(readFrameQaBlockCount({ blockCount: 2 }), 2);
});

test("[frame-qa-gate] MOCK 引擎：不质检、不写质检列（null = 未质检）", async () => {
  const { d, calls } = deps();
  const decision = await decideFrameQaGate(
    { jobId: "job_mock", provider: VideoProvider.MOCK, videoUrl: "https://x/y.mp4" },
    d,
  );
  assert.deepEqual(decision, { action: "pass", successData: {} });
  assert.equal(calls.qa, 0);
});

test("[frame-qa-gate] 门禁未启用 / 无视频地址 → SKIPPED（不占预算、不 defer）", async () => {
  process.env.FRAME_QA_OUTSIDE_BUDGET = "defer";
  const { d, calls } = deps({ isFrameQaEnabled: () => false });
  const disabled = await decideFrameQaGate(
    {
      jobId: "job_off",
      provider: VideoProvider.SEEDANCE_T2V,
      videoUrl: "https://x/y.mp4",
      priorFrameQaDetail: { blockCount: 1 },
    },
    d,
  );
  assert.equal(disabled.action, "pass");
  if (disabled.action === "pass") {
    assert.equal(disabled.successData.frameQaStatus, "SKIPPED");
    assert.equal(detailOf(disabled.successData as Record<string, unknown>).blockCount, 1);
  }
  const noUrl = await decideFrameQaGate(
    { jobId: "job_nourl", provider: VideoProvider.SEEDANCE_T2V, videoUrl: null },
    deps().d,
  );
  assert.equal(noUrl.action, "pass");
  if (noUrl.action === "pass") assert.equal(noUrl.successData.frameQaStatus, "SKIPPED");
  assert.equal(calls.qa, 0);
});

test("[frame-qa-gate] 生产默认：预算上下文之外（用户面轮询）defer，不跑质检", async () => {
  delete process.env.FRAME_QA_OUTSIDE_BUDGET;
  (process.env as Record<string, string>).NODE_ENV = "production";
  assert.equal(gateTest.outsideBudgetPolicy(), "defer");
  const { d, calls } = deps();
  const decision = await decideFrameQaGate(
    { jobId: "job_user_poll", provider: VideoProvider.SEEDANCE_T2V, videoUrl: "https://x/y.mp4" },
    d,
  );
  assert.deepEqual(decision, { action: "defer", reason: "frame_qa_outside_cron_budget" });
  assert.equal(calls.qa, 0);
});

test("[frame-qa-gate] 非生产默认 inline（本机没有 cron 也能收尾），可用 env 显式改 defer", () => {
  delete process.env.FRAME_QA_OUTSIDE_BUDGET;
  (process.env as Record<string, string>).NODE_ENV = "development";
  assert.equal(gateTest.outsideBudgetPolicy(), "inline");
  process.env.FRAME_QA_OUTSIDE_BUDGET = "defer";
  assert.equal(gateTest.outsideBudgetPolicy(), "defer");
});

test("[frame-qa-gate] cron 预算内：真跑质检，历史拦截次数从库里读取一次", async () => {
  process.env.FRAME_QA_OUTSIDE_BUDGET = "defer";
  const { d, calls } = deps({
    runFrameTextQa: async () => {
      calls.qa += 1;
      return BLOCK_VERDICT;
    },
    loadPriorDetail: async () => {
      calls.load += 1;
      return { blockCount: 2 };
    },
  });
  const decision = await runWithFrameQaBudget(
    { label: "cron:test", maxChecks: 2, timeBudgetMs: 180_000 },
    async () => {
      const result = await decideFrameQaGate(
        { jobId: "job_cron", provider: VideoProvider.SEEDANCE_T2V, videoUrl: "https://x/y.mp4" },
        d,
      );
      assert.deepEqual(frameQaBudgetUsage(), {
        label: "cron:test",
        used: 1,
        maxChecks: 2,
        deferred: 0,
      });
      return result;
    },
  );
  assert.equal(calls.qa, 1);
  assert.equal(calls.load, 1);
  assert.equal(decision.action, "pass");
  if (decision.action === "pass") {
    assert.equal(decision.successData.frameQaStatus, "WOULD_BLOCK");
    assert.equal(detailOf(decision.successData as Record<string, unknown>).budget, "cron:test");
  }
});

test("[frame-qa-gate] 调用方带入 priorFrameQaDetail 时不再查库", async () => {
  const { d, calls } = deps();
  await runWithFrameQaBudget({ label: "cron:test", maxChecks: 1, timeBudgetMs: 180_000 }, () =>
    decideFrameQaGate(
      {
        jobId: "job_known",
        provider: VideoProvider.SEEDANCE_T2V,
        videoUrl: "https://x/y.mp4",
        priorFrameQaDetail: null,
      },
      d,
    ),
  );
  assert.equal(calls.qa, 1);
  assert.equal(calls.load, 0);
});

test("[frame-qa-gate] 预算条数用满 → 其余 defer 并计数，留给下一次 cron", async () => {
  process.env.FRAME_QA_OUTSIDE_BUDGET = "defer";
  const { d, calls } = deps();
  const decisions = await runWithFrameQaBudget(
    { label: "cron:test", maxChecks: 2, timeBudgetMs: 180_000 },
    async () => {
      const out = [];
      for (let i = 0; i < 4; i++) {
        out.push(
          await decideFrameQaGate(
            { jobId: `job_${i}`, provider: VideoProvider.SEEDANCE_T2V, videoUrl: "https://x/y.mp4" },
            d,
          ),
        );
      }
      assert.equal(frameQaBudgetUsage()?.deferred, 2);
      return out;
    },
  );
  assert.equal(calls.qa, 2);
  assert.deepEqual(
    decisions.map((x) => x.action),
    ["pass", "pass", "defer", "defer"],
  );
  assert.deepEqual(decisions[2], { action: "defer", reason: "frame_qa_budget_checks_exhausted" });
});

test("[frame-qa-gate] 剩余时间不够一次最坏耗时 → defer（不把函数拖过 maxDuration）", async () => {
  const { d, calls } = deps();
  const decision = await runWithFrameQaBudget(
    { label: "cron:test", maxChecks: 10, timeBudgetMs: gateTest.PER_CHECK_RESERVE_MS - 1 },
    () =>
      decideFrameQaGate(
        { jobId: "job_late", provider: VideoProvider.SEEDANCE_T2V, videoUrl: "https://x/y.mp4" },
        d,
      ),
  );
  assert.deepEqual(decision, { action: "defer", reason: "frame_qa_budget_time_exhausted" });
  assert.equal(calls.qa, 0);
});

test("[frame-qa-gate] 预算上下文互不串：上下文结束后用量不可见", async () => {
  await runWithFrameQaBudget({ label: "a", ...CRON_FRAME_QA_BUDGET }, async () => {
    assert.equal(frameQaBudgetUsage()?.label, "a");
  });
  assert.equal(frameQaBudgetUsage(), null);
  /// cron 默认预算：最坏 4 × (45s + 余量) 落在 maxDuration=300 之内
  assert.ok(CRON_FRAME_QA_BUDGET.timeBudgetMs < 300_000);
});
