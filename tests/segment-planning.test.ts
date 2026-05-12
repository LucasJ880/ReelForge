import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TARGET_DURATION_SEC,
  DURATION_OPTIONS,
  SEEDANCE_SEGMENT_MAX_SEC,
  SUPPORTED_DURATIONS_SEC,
  normalizeDuration,
  planSegments,
  requiresStitching,
} from "../src/lib/duration/segment-planner";

test("planSegments: 15s → 1 段 × 15s", () => {
  const segs = planSegments(15);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].segmentIndex, 0);
  assert.equal(segs[0].durationSec, 15);
});

test("planSegments: 30s → 2 段 × 15s", () => {
  const segs = planSegments(30);
  assert.equal(segs.length, 2);
  assert.deepEqual(
    segs.map((s) => s.segmentIndex),
    [0, 1],
  );
  assert.deepEqual(
    segs.map((s) => s.durationSec),
    [15, 15],
  );
  assert.equal(segs[0].role, "hook");
  assert.equal(segs[1].role, "cta");
});

test("planSegments: 60s → 4 段 × 15s", () => {
  const segs = planSegments(60);
  assert.equal(segs.length, 4);
  assert.deepEqual(
    segs.map((s) => s.segmentIndex),
    [0, 1, 2, 3],
  );
  for (const s of segs) {
    assert.equal(s.durationSec, 15);
  }
  assert.equal(segs[0].role, "hook");
  assert.equal(segs[3].role, "cta");
});

test("planSegments: 单段时长不超过 SEEDANCE_SEGMENT_MAX_SEC", () => {
  for (const d of SUPPORTED_DURATIONS_SEC) {
    const segs = planSegments(d);
    for (const s of segs) {
      assert.ok(
        s.durationSec <= SEEDANCE_SEGMENT_MAX_SEC,
        `duration=${d} segment ${s.segmentIndex} 超过单段上限`,
      );
    }
    /// 段时长之和等于目标时长（对支持档位）
    const sum = segs.reduce((acc, s) => acc + s.durationSec, 0);
    assert.equal(sum, d, `duration=${d} 段时长之和不等于目标时长`);
  }
});

test("planSegments: 兜底 — 任意时长按 15s 切片", () => {
  const segs = planSegments(45);
  /// 45s = 3 段 × 15s
  assert.equal(segs.length, 3);
  for (const s of segs) {
    assert.equal(s.durationSec, 15);
  }
});

test("planSegments: 0 / 负数 → 空数组", () => {
  assert.equal(planSegments(0).length, 0);
  assert.equal(planSegments(-5).length, 0);
});

test("requiresStitching: 单段 false / 多段 true", () => {
  assert.equal(requiresStitching(15), false);
  assert.equal(requiresStitching(30), true);
  assert.equal(requiresStitching(60), true);
});

test("normalizeDuration: 任意输入 → 最近的支持档位", () => {
  assert.equal(normalizeDuration(15), 15);
  assert.equal(normalizeDuration(20), 15);
  assert.equal(normalizeDuration(28), 30);
  assert.equal(normalizeDuration(45), 30);
  assert.equal(normalizeDuration(50), 60);
  assert.equal(normalizeDuration(null), DEFAULT_TARGET_DURATION_SEC);
  assert.equal(normalizeDuration(undefined), DEFAULT_TARGET_DURATION_SEC);
});

test("DURATION_OPTIONS: 15/30/60 + 30 默认推荐", () => {
  assert.equal(DURATION_OPTIONS.length, 3);
  const recommended = DURATION_OPTIONS.find((o) => o.recommended);
  assert.ok(recommended);
  assert.equal(recommended!.durationSec, 30);
});
