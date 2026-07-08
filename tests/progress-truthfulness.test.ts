import assert from "node:assert/strict";
import test from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import {
  containsBannedCustomerTerm,
  deriveBusinessStatus,
} from "../src/lib/video-generation/business-status";
import { derivePersonalStatus } from "../src/lib/video-generation/personal-status";

/**
 * 第三阶段审计项 4 —— 进度真实性回归测试。
 *
 * 要求：
 *  - generating 阶段的百分比来自真实段完成数（不是固定 55%）
 *  - assembling 区分「排队等待合成」(waiting) 与「合成执行中」(active)，
 *    对应文案说真话（本次事故里 85% 实际含义是"等待合成"，UI 必须这么说）
 */

test("进度真实性：generating 按已成功段数插值，不是固定值", () => {
  const base = {
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.PENDING,
    jobStatuses: [VideoJobStatus.RUNNING],
  };
  const p0 = deriveBusinessStatus({
    ...base,
    segmentsSucceeded: 0,
    segmentsTotal: 4,
  });
  const p2 = deriveBusinessStatus({
    ...base,
    segmentsSucceeded: 2,
    segmentsTotal: 4,
  });
  const p3 = deriveBusinessStatus({
    ...base,
    segmentsSucceeded: 3,
    segmentsTotal: 4,
  });
  assert.equal(p0.status, "generating");
  assert.ok(p0.progressHint < p2.progressHint, "0/4 应低于 2/4");
  assert.ok(p2.progressHint < p3.progressHint, "2/4 应低于 3/4");
  assert.equal(p2.progressHint, 0.2 + 0.6 * 0.5);
});

test("进度真实性：段全部成功 + PENDING = 排队等待合成（waiting），文案说真话", () => {
  const out = deriveBusinessStatus({
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.PENDING,
    segmentsSucceeded: 1,
    segmentsTotal: 1,
    jobStatuses: [VideoJobStatus.SUCCEEDED],
  });
  assert.equal(out.status, "assembling");
  assert.equal(out.assemblingPhase, "waiting");
  assert.ok(
    out.label.includes("排队"),
    `等待合成时文案必须说明在排队，实际: ${out.label}`,
  );
  assert.equal(out.progressHint, 0.85);
  assert.equal(containsBannedCustomerTerm(out.label), false);
});

test("进度真实性：STITCHING = 合成执行中（active），进度高于排队", () => {
  const waiting = deriveBusinessStatus({
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.PENDING,
    segmentsSucceeded: 1,
    segmentsTotal: 1,
    jobStatuses: [VideoJobStatus.SUCCEEDED],
  });
  const active = deriveBusinessStatus({
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.STITCHING,
    segmentsSucceeded: 1,
    segmentsTotal: 1,
    jobStatuses: [VideoJobStatus.SUCCEEDED],
  });
  assert.equal(active.status, "assembling");
  assert.equal(active.assemblingPhase, "active");
  assert.equal(active.label, "正在合成最终视频");
  assert.ok(active.progressHint > waiting.progressHint);
});

test("进度真实性：C 端排队等待合成的 progressHint_text 也说真话", () => {
  const personal = derivePersonalStatus({
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.PENDING,
    segmentsSucceeded: 1,
    segmentsTotal: 1,
    jobStatuses: [VideoJobStatus.SUCCEEDED],
  });
  assert.equal(personal.status, "assembling");
  assert.ok(personal.progressHint_text?.includes("排队"));
  const stitching = derivePersonalStatus({
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.STITCHING,
    segmentsSucceeded: 1,
    segmentsTotal: 1,
    jobStatuses: [VideoJobStatus.SUCCEEDED],
  });
  assert.equal(stitching.progressHint_text, "正在合成最终视频");
});

test("进度真实性：ready / failed 的进度保持终态语义", () => {
  const ready = deriveBusinessStatus({
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.READY,
  });
  assert.equal(ready.progressHint, 1);
  assert.equal(ready.assemblingPhase, null);
  const failed = deriveBusinessStatus({
    briefStatus: null,
    finalVideoStatus: FinalVideoStatus.FAILED,
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.progressHint, 0);
});
