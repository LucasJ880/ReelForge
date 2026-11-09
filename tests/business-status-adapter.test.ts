import assert from "node:assert/strict";
import test from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import {
  RUNNING_LONG_THRESHOLD_MS,
  containsBannedCustomerTerm,
  deriveBusinessStatus,
  runningLongMinutes,
  __test__,
} from "../src/lib/video-generation/business-status";
import { getPlatformCopy } from "../src/i18n/platform-copy";

const { LABELS } = __test__;

test("business-status: failed 短路 —— FinalVideo FAILED", () => {
  const r = deriveBusinessStatus({
    finalVideoStatus: FinalVideoStatus.FAILED,
    briefStatus: VideoBriefStatus.RENDERING,
  });
  assert.equal(r.status, "failed");
  assert.equal(r.label, LABELS.failed);
});

test("business-status: failed 短路 —— Brief RENDER_FAILED", () => {
  const r = deriveBusinessStatus({
    briefStatus: VideoBriefStatus.RENDER_FAILED,
  });
  assert.equal(r.status, "failed");
});

test("business-status: failed —— 所有 jobs 都 FAILED", () => {
  const r = deriveBusinessStatus({
    jobStatuses: [VideoJobStatus.FAILED, VideoJobStatus.FAILED],
  });
  assert.equal(r.status, "failed");
});

test("business-status: ready —— FinalVideo READY", () => {
  const r = deriveBusinessStatus({
    finalVideoStatus: FinalVideoStatus.READY,
  });
  assert.equal(r.status, "ready");
});

test("business-status: ready —— QA_PENDING（video-service 在 finalVideoUrl 写完后才置位）", () => {
  const r = deriveBusinessStatus({
    briefStatus: VideoBriefStatus.QA_PENDING,
  });
  assert.equal(r.status, "ready");
});

test("business-status: ready —— QA_APPROVED / PUBLISHED 等下游态", () => {
  for (const bs of [
    VideoBriefStatus.QA_APPROVED,
    VideoBriefStatus.PUBLISH_PENDING,
    VideoBriefStatus.PUBLISHED,
    VideoBriefStatus.METRICS_COLLECTING,
    VideoBriefStatus.SCORED,
    VideoBriefStatus.ARCHIVED,
  ]) {
    const r = deriveBusinessStatus({ briefStatus: bs });
    assert.equal(r.status, "ready", `bs=${bs} 应该 ready`);
  }
});

test("business-status: assembling —— FinalVideo STITCHING", () => {
  const r = deriveBusinessStatus({
    finalVideoStatus: FinalVideoStatus.STITCHING,
  });
  assert.equal(r.status, "assembling");
});

test("business-status: assembling —— PENDING + 所有 AI 段已 SUCCEEDED", () => {
  const r = deriveBusinessStatus({
    finalVideoStatus: FinalVideoStatus.PENDING,
    segmentsTotal: 3,
    segmentsSucceeded: 3,
  });
  assert.equal(r.status, "assembling");
});

test("business-status: generating —— RENDERING / RENDER_QUEUED", () => {
  for (const bs of [
    VideoBriefStatus.RENDER_QUEUED,
    VideoBriefStatus.RENDERING,
    VideoBriefStatus.RENDER_SUCCEEDED,
  ]) {
    const r = deriveBusinessStatus({ briefStatus: bs });
    assert.equal(r.status, "generating", `bs=${bs} 应 generating`);
  }
});

test("business-status: generating —— 任意 job RUNNING/QUEUED", () => {
  const r = deriveBusinessStatus({
    jobStatuses: [VideoJobStatus.SUCCEEDED, VideoJobStatus.RUNNING],
  });
  assert.equal(r.status, "generating");
});

test("business-status: planning —— BRIEF_PENDING / SCRIPT_* / SCENE_PROMPT_READY", () => {
  for (const bs of [
    VideoBriefStatus.BRIEF_PENDING,
    VideoBriefStatus.SCRIPT_DRAFTING,
    VideoBriefStatus.SCRIPT_READY,
    VideoBriefStatus.SCENE_PROMPT_READY,
  ]) {
    const r = deriveBusinessStatus({ briefStatus: bs });
    assert.equal(r.status, "planning", `bs=${bs} 应 planning`);
  }
});

test("business-status: 兜底 planning（空输入）", () => {
  const r = deriveBusinessStatus({});
  assert.equal(r.status, "planning");
});

test("business-status: label 不含「渲染」「ffmpeg」「seedance」「provider」内部术语", () => {
  for (const [, label] of Object.entries(LABELS)) {
    assert.ok(!/渲染|ffmpeg|seedance|provider|stitch/i.test(label), `内部术语泄漏: ${label}`);
  }
});

test("business-status: progressHint 单调（planning < generating < assembling < ready）", () => {
  const planning = deriveBusinessStatus({ briefStatus: VideoBriefStatus.BRIEF_PENDING });
  const generating = deriveBusinessStatus({ briefStatus: VideoBriefStatus.RENDERING });
  const assembling = deriveBusinessStatus({ finalVideoStatus: FinalVideoStatus.STITCHING });
  const ready = deriveBusinessStatus({ finalVideoStatus: FinalVideoStatus.READY });
  assert.ok(planning.progressHint < generating.progressHint);
  assert.ok(generating.progressHint < assembling.progressHint);
  assert.ok(assembling.progressHint < ready.progressHint);
});

test("等得比平时久：过了 45 分钟才报已等待分钟数；没在飞或还早都是 null（10 月两条 5 小时任务的形状）", () => {
  assert.equal(RUNNING_LONG_THRESHOLD_MS, 45 * 60_000);
  assert.equal(runningLongMinutes(null), null);
  assert.equal(runningLongMinutes(undefined), null);
  assert.equal(runningLongMinutes(12.5 * 60_000), null, "P50 的正常等待不打扰");
  assert.equal(runningLongMinutes(44 * 60_000 + 59_000), null);
  assert.equal(runningLongMinutes(45 * 60_000), 45);
  assert.equal(runningLongMinutes(308.2 * 60_000), 308);
});

test("等得比平时久的提示：中英文都带分钟占位、说明可以取消，且不带内部术语", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const copy = getPlatformCopy(locale).library;
    assert.ok(copy.waitingLong.includes("{n}"), locale);
    assert.equal(containsBannedCustomerTerm(copy.waitingLong), false, locale);
  }
  const zh = getPlatformCopy("zh-CN").library;
  assert.ok(zh.waitingLong.includes(`「${zh.cancelVideo}」`), "提示里的按钮名要和真按钮一字不差");
  assert.doesNotMatch(getPlatformCopy("en-US").library.waitingLong, /[㐀-鿿]/);
});
