/**
 * 交付后补检（src/lib/services/frame-qa-recheck-service.ts）。
 * 质检坏掉期间「没检成就交付」的成片，服务恢复后要有人回头看——且绝不能动已交付的片子本身。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { FRAME_QA_STATUS } from "../src/lib/services/frame-qa-gate";
import {
  FRAME_QA_RECHECK_MAX_ATTEMPTS,
  FRAME_QA_RECHECK_MIN_INTERVAL_MS,
  FRAME_QA_RECHECK_WINDOW_MS,
  decideFrameQaRecheck,
  frameQaRecheckWhere,
  runPendingFrameQaRechecks,
  type FrameQaRecheckDeps,
  type FrameQaRecheckRow,
} from "../src/lib/services/frame-qa-recheck-service";
import type { FrameQaVerdict } from "../src/lib/video-generation/frame-qa";

const NOW = new Date("2026-11-09T21:45:00.000Z");
const PASS: FrameQaVerdict = { ok: true, checked: true, frameCount: 6, issues: [], summary: "帧质检通过（6 帧无画面文字）" };
const FOUND: FrameQaVerdict = {
  ok: false,
  checked: true,
  frameCount: 6,
  issues: [{ frameIndex: 2, detail: "底部烧录字幕" }],
  summary: "帧质检拦截：第3帧 底部烧录字幕",
};
const NO_CREDITS = "门禁执行异常：429 You have no credits remaining.";
const BROKEN: FrameQaVerdict = { ok: true, checked: false, skipReason: NO_CREDITS, frameCount: 0, issues: [], summary: `帧质检跳过：${NO_CREDITS}` };

function row(id: string, detail: unknown = { skipReason: NO_CREDITS, blockCount: 1 }): FrameQaRecheckRow {
  return { id, outputVideoUrl: `https://cdn.example.com/${id}.mp4`, frameQaCheckedAt: new Date("2026-11-08T10:00:00.000Z"), frameQaDetail: detail };
}

function harness(rows: FrameQaRecheckRow[], verdicts: FrameQaVerdict[], overrides: Partial<FrameQaRecheckDeps> = {}) {
  const saved: Array<{ id: string; status: string; summary: string; recheckCount?: number; checkedAt: Date; claimedAt: Date }> = [];
  const alerts: string[] = [];
  const calls = { qa: 0, reserved: 0, released: 0, find: 0 };
  let slots = 4;
  const deps: FrameQaRecheckDeps = {
    isFrameQaEnabled: () => true,
    findCandidates: async () => {
      calls.find += 1;
      return rows;
    },
    claim: async () => true,
    save: async (id, claimedAt, status, detail, checkedAt) => {
      saved.push({ id, status, summary: detail.summary, recheckCount: detail.recheckCount, checkedAt, claimedAt });
      return true;
    },
    runFrameTextQa: async () => verdicts[calls.qa++] ?? PASS,
    reserveSlot: () => {
      if (slots <= 0) return { ok: false };
      slots -= 1;
      calls.reserved += 1;
      return { ok: true };
    },
    releaseSlot: () => {
      calls.released += 1;
    },
    budgetUsage: () => ({ deferred: 0, visionFailures: 0 }),
    alertFlagged: async (jobId) => {
      alerts.push(jobId);
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, saved, alerts, calls, setSlots: (n: number) => (slots = n) };
}

test("候选条件：只碰已成片 + 没检成、7 天内、距上次尝试满 30 分钟、没被替换的行", () => {
  const where = frameQaRecheckWhere(NOW);
  assert.equal(where.status, VideoJobStatus.SUCCEEDED);
  assert.equal(where.frameQaStatus, FRAME_QA_STATUS.UNVERIFIED);
  assert.equal(where.supersededAt, null);
  assert.deepEqual(where.outputVideoUrl, { not: null });
  assert.deepEqual(where.finishedAt, { gte: new Date(NOW.getTime() - FRAME_QA_RECHECK_WINDOW_MS) });
  assert.deepEqual(where.OR, [
    { frameQaCheckedAt: null },
    { frameQaCheckedAt: { lt: new Date(NOW.getTime() - FRAME_QA_RECHECK_MIN_INTERVAL_MS) } },
  ]);
});

test("补检通过 → PASSED，保留历史拦截次数，记下是第几次补检", () => {
  const decision = decideFrameQaRecheck({ verdict: PASS, priorDetail: { blockCount: 1 }, checkedAt: NOW });
  assert.equal(decision.status, FRAME_QA_STATUS.PASSED);
  assert.equal(decision.outcome, "passed");
  assert.equal(decision.detail.checked, true);
  assert.equal(decision.detail.blockCount, 1);
  assert.equal(decision.detail.recheckCount, 1);
  assert.equal(decision.detail.budget, "recheck");
});

test("补检检出画面文字 → WOULD_BLOCK 待人工复核，绝不是 BLOCKED（片子已经交付，拦不回来）", () => {
  const decision = decideFrameQaRecheck({ verdict: FOUND, priorDetail: null, checkedAt: NOW });
  assert.equal(decision.status, FRAME_QA_STATUS.WOULD_BLOCK);
  assert.notEqual(decision.status, FRAME_QA_STATUS.BLOCKED);
  assert.equal(decision.outcome, "flagged");
  assert.match(decision.detail.warning ?? "", /人工复核/);
  assert.equal(decision.detail.issues.length, 1);
});

test("还是没检成 → 保持 UNVERIFIED 等下次；满上限改记 SKIPPED 收口", () => {
  const again = decideFrameQaRecheck({ verdict: BROKEN, priorDetail: { recheckCount: 1 }, checkedAt: NOW });
  assert.equal(again.status, FRAME_QA_STATUS.UNVERIFIED);
  assert.equal(again.outcome, "still_unverified");
  assert.equal(again.detail.recheckCount, 2);
  assert.equal(again.detail.skipReason, NO_CREDITS);

  const last = decideFrameQaRecheck({
    verdict: BROKEN,
    priorDetail: { recheckCount: FRAME_QA_RECHECK_MAX_ATTEMPTS - 1 },
    checkedAt: NOW,
  });
  assert.equal(last.status, FRAME_QA_STATUS.SKIPPED);
  assert.equal(last.outcome, "gave_up");
  assert.match(last.detail.summary, /不再重试/);
});

test("门禁被显式关掉时的「没检」不是故障：直接收口成 SKIPPED，不反复重试", () => {
  const decision = decideFrameQaRecheck({
    verdict: { ...BROKEN, skipReason: "门禁未启用（mock 模式或未配置）" },
    priorDetail: null,
    checkedAt: NOW,
  });
  assert.equal(decision.status, FRAME_QA_STATUS.SKIPPED);
  assert.equal(decision.outcome, "gave_up");
});

test("一轮补检：通过的落 PASSED，检出的落 WOULD_BLOCK 并告警一次", async () => {
  const { deps, saved, alerts, calls } = harness([row("job_a"), row("job_b")], [PASS, FOUND]);
  const sweep = await runPendingFrameQaRechecks(2, deps);
  assert.deepEqual(
    { scanned: sweep.scanned, passed: sweep.passed, flagged: sweep.flagged, stillUnverified: sweep.stillUnverified },
    { scanned: 2, passed: 1, flagged: 1, stillUnverified: 0 },
  );
  assert.deepEqual(saved.map((entry) => [entry.id, entry.status]), [
    ["job_a", FRAME_QA_STATUS.PASSED],
    ["job_b", FRAME_QA_STATUS.WOULD_BLOCK],
  ]);
  assert.deepEqual(alerts, ["job_b"]);
  assert.equal(calls.reserved, 2);
});

test("vision 还没恢复：第一条仍没检成就收手，不把这一轮的预算和下载都白花掉", async () => {
  const { deps, saved, calls } = harness([row("job_a"), row("job_b"), row("job_c")], [BROKEN, PASS, PASS]);
  const sweep = await runPendingFrameQaRechecks(3, deps);
  assert.equal(calls.qa, 1);
  assert.equal(sweep.stillUnverified, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.status, FRAME_QA_STATUS.UNVERIFIED);
  assert.equal(saved[0]?.checkedAt.getTime(), saved[0]?.claimedAt.getTime(), "留在认领时刻，30 分钟后才会再被拿到");
});

test("让路：段级门禁本轮有排队或 vision 刚报错，补检整轮跳过、不查库", async () => {
  const deferred = harness([row("job_a")], [PASS], { budgetUsage: () => ({ deferred: 1, visionFailures: 0 }) });
  assert.equal((await runPendingFrameQaRechecks(2, deferred.deps)).skippedRound, "segment_gate_deferred");
  assert.equal(deferred.calls.find, 0);

  const failing = harness([row("job_a")], [PASS], { budgetUsage: () => ({ deferred: 0, visionFailures: 2 }) });
  assert.equal((await runPendingFrameQaRechecks(2, failing.deps)).skippedRound, "segment_gate_vision_failed");
  assert.equal(failing.calls.qa, 0);

  const disabled = harness([row("job_a")], [PASS], { isFrameQaEnabled: () => false });
  assert.equal((await runPendingFrameQaRechecks(2, disabled.deps)).skippedRound, "disabled");
});

test("预算用完就停；认领不到（别的调用在检）把名额还回去；落库 CAS 失败不计数", async () => {
  const noBudget = harness([row("job_a"), row("job_b")], [PASS, PASS]);
  noBudget.setSlots(1);
  const first = await runPendingFrameQaRechecks(2, noBudget.deps);
  assert.equal(first.passed, 1);
  assert.equal(first.deferred, 1);

  const contested = harness([row("job_a")], [PASS], { claim: async () => false });
  const second = await runPendingFrameQaRechecks(2, contested.deps);
  assert.equal(contested.calls.qa, 0);
  assert.equal(contested.calls.released, 1);
  assert.equal(second.passed, 0);

  const stale = harness([row("job_a")], [PASS], { save: async () => false });
  assert.equal((await runPendingFrameQaRechecks(2, stale.deps)).passed, 0);
});
