import assert from "node:assert/strict";
import test from "node:test";
import {
  WATCHDOG_STALLED_PREFIX,
  WATCHDOG_STALLED_USER_ERROR,
  WATCHDOG_TIMEOUT_PREFIX,
  WATCHDOG_TIMEOUT_USER_ERROR,
  detectProviderStall,
  isPastHardDeadline,
  providerStallMin,
  videoJobDeadlineMin,
} from "../src/lib/services/video-watchdog";

/**
 * Watchdog 双信号纯函数测试（INV-1 判定逻辑本体）。
 *
 * 信号 A（硬超时）：now > timeoutAt + 宽限 → 超时
 * 信号 B（provider 僵死）：provider 报 running 且 updated_at 距 created_at
 *   从未推进、任务已存在超过 PROVIDER_STALL_MIN → 僵死
 */

const NOW = new Date("2026-07-13T02:00:00Z");
const MIN = 60_000;

/// ---------- 信号 A ----------

test("watchdog 信号 A：超过 timeoutAt + 宽限 → 判超时", () => {
  const job = { timeoutAt: new Date(NOW.getTime() - 5 * MIN) };
  /// 默认宽限 2 分钟，超时 5 分钟 > 2 分钟宽限
  assert.equal(isPastHardDeadline(job, NOW), true);
});

test("watchdog 信号 A：刚过 timeoutAt 但仍在宽限内 → 不判超时", () => {
  const job = { timeoutAt: new Date(NOW.getTime() - 1 * MIN) };
  assert.equal(isPastHardDeadline(job, NOW), false);
});

test("watchdog 信号 A：timeoutAt 为 null → 不由信号 A 处理（sweep createdAt 兜底）", () => {
  assert.equal(isPastHardDeadline({ timeoutAt: null }, NOW), false);
});

test("watchdog 信号 A：deadline 可配置（VIDEO_JOB_DEADLINE_MIN）", () => {
  const prev = process.env.VIDEO_JOB_DEADLINE_MIN;
  process.env.VIDEO_JOB_DEADLINE_MIN = "7";
  try {
    assert.equal(videoJobDeadlineMin(), 7);
  } finally {
    if (prev === undefined) delete process.env.VIDEO_JOB_DEADLINE_MIN;
    else process.env.VIDEO_JOB_DEADLINE_MIN = prev;
  }
});

/// ---------- 信号 B ----------

function unixSec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

test("watchdog 信号 B：running + updated_at 从未推进 + 超过阈值 → 判僵死", () => {
  const createdAt = unixSec(new Date(NOW.getTime() - 20 * MIN));
  const verdict = detectProviderStall(
    {
      status: "processing",
      rawProviderResponse: {
        status: "running",
        created_at: createdAt,
        updated_at: createdAt,
      },
    },
    NOW,
  );
  assert.equal(verdict.stalled, true);
  assert.ok(verdict.detail, "僵死判定必须带证据 detail");
});

test("watchdog 信号 B：running 但 updated_at 有推进 → 不判僵死", () => {
  const createdAt = unixSec(new Date(NOW.getTime() - 20 * MIN));
  const verdict = detectProviderStall(
    {
      status: "processing",
      rawProviderResponse: {
        status: "running",
        created_at: createdAt,
        updated_at: createdAt + 60,
      },
    },
    NOW,
  );
  assert.equal(verdict.stalled, false);
});

test("watchdog 信号 B：还没到阈值时长 → 不判僵死（避免误杀刚提交任务）", () => {
  const createdAt = unixSec(
    new Date(NOW.getTime() - (providerStallMin() - 1) * MIN),
  );
  const verdict = detectProviderStall(
    {
      status: "processing",
      rawProviderResponse: {
        status: "running",
        created_at: createdAt,
        updated_at: createdAt,
      },
    },
    NOW,
  );
  assert.equal(verdict.stalled, false);
});

test("watchdog 信号 B：终态响应永不判僵死", () => {
  const createdAt = unixSec(new Date(NOW.getTime() - 60 * MIN));
  for (const status of ["completed", "failed"] as const) {
    const verdict = detectProviderStall(
      {
        status,
        rawProviderResponse: {
          created_at: createdAt,
          updated_at: createdAt,
        },
      },
      NOW,
    );
    assert.equal(verdict.stalled, false, `status=${status} 不应判僵死`);
  }
});

test("watchdog 信号 B：响应缺少时间戳字段 → 保守不判僵死", () => {
  const verdict = detectProviderStall(
    { status: "processing", rawProviderResponse: { status: "running" } },
    NOW,
  );
  assert.equal(verdict.stalled, false);
});

test("watchdog 信号 B：阈值可配置（PROVIDER_STALL_MIN）", () => {
  const prev = process.env.PROVIDER_STALL_MIN;
  process.env.PROVIDER_STALL_MIN = "3";
  try {
    const createdAt = unixSec(new Date(NOW.getTime() - 5 * MIN));
    const verdict = detectProviderStall(
      {
        status: "processing",
        rawProviderResponse: {
          status: "running",
          created_at: createdAt,
          updated_at: createdAt,
        },
      },
      NOW,
    );
    assert.equal(verdict.stalled, true, "5 分钟 > 3 分钟阈值应判僵死");
  } finally {
    if (prev === undefined) delete process.env.PROVIDER_STALL_MIN;
    else process.env.PROVIDER_STALL_MIN = prev;
  }
});

/// ---------- 用户文案守门 ----------

test("watchdog 用户文案不含内部术语；errorMessage 前缀机器可读", async () => {
  const { containsBannedPersonalTerm } = await import(
    "../src/lib/video-generation/personal-status"
  );
  assert.equal(containsBannedPersonalTerm(WATCHDOG_TIMEOUT_USER_ERROR), false);
  assert.equal(containsBannedPersonalTerm(WATCHDOG_STALLED_USER_ERROR), false);
  assert.ok(WATCHDOG_TIMEOUT_PREFIX.startsWith("[watchdog:"));
  assert.ok(WATCHDOG_STALLED_PREFIX.startsWith("[watchdog:"));
});
