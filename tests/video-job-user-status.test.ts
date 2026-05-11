import assert from "node:assert/strict";
import test from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { __test__ } from "../src/lib/services/video-service";
import {
  BRIEF_USER_LABELS,
  VIDEO_JOB_USER_LABELS,
  briefStatusToProgressIndex,
  bucketBriefForParentSummary,
} from "../src/lib/labels-user";

const { classifyUserStatus, friendlySubmitError, friendlyProviderError } =
  __test__;

const baseJob = {
  status: VideoJobStatus.RUNNING,
  submittedAt: new Date(),
  startedAt: new Date(),
  externalJobId: "task_xyz",
};

test("classifyUserStatus: SUCCEEDED → ready", () => {
  assert.equal(
    classifyUserStatus({ ...baseJob, status: VideoJobStatus.SUCCEEDED }, false),
    "ready",
  );
});

test("classifyUserStatus: FAILED → failed", () => {
  assert.equal(
    classifyUserStatus({ ...baseJob, status: VideoJobStatus.FAILED }, false),
    "failed",
  );
});

test("classifyUserStatus: RUNNING with externalJobId → generating", () => {
  assert.equal(
    classifyUserStatus(baseJob, false),
    "generating",
  );
});

test("classifyUserStatus: RUNNING without externalJobId → submitted (尚未与 provider 握手)", () => {
  assert.equal(
    classifyUserStatus({ ...baseJob, externalJobId: null }, false),
    "submitted",
  );
});

test("classifyUserStatus: timeoutAt 已过 → stuck", () => {
  assert.equal(classifyUserStatus(baseJob, true), "stuck");
});

test("classifyUserStatus: QUEUED → waiting", () => {
  assert.equal(
    classifyUserStatus({ ...baseJob, status: VideoJobStatus.QUEUED }, false),
    "waiting",
  );
});

test("VIDEO_JOB_USER_LABELS: 必须避免内部术语「渲染」「ffmpeg」「seedance」「provider」", () => {
  for (const [key, label] of Object.entries(VIDEO_JOB_USER_LABELS)) {
    for (const banned of ["渲染", "ffmpeg", "seedance", "provider", "Render"]) {
      assert.ok(
        !label.includes(banned),
        `key=${key} label="${label}" 含有面向客户禁用的内部术语 "${banned}"`,
      );
    }
  }
});

test("BRIEF_USER_LABELS: 不再使用「渲染」作为客户可见词", () => {
  for (const [key, label] of Object.entries(BRIEF_USER_LABELS)) {
    assert.ok(
      !label.includes("渲染"),
      `BRIEF_USER_LABELS["${key}"] = "${label}" 仍含「渲染」`,
    );
  }
});

test("BRIEF_USER_LABELS: RENDER_QUEUED / RENDERING 改成动词化文案", () => {
  assert.equal(BRIEF_USER_LABELS.RENDER_QUEUED, "视频请求已发送");
  assert.equal(BRIEF_USER_LABELS.RENDERING, "正在生成视频");
  assert.equal(BRIEF_USER_LABELS.RENDER_SUCCEEDED, "视频已生成");
});

test("briefStatusToProgressIndex: 状态映射到 4 步进度（0..4）", () => {
  assert.equal(briefStatusToProgressIndex("BRIEF_PENDING"), 0);
  assert.equal(briefStatusToProgressIndex("SCRIPT_READY"), 1);
  assert.equal(briefStatusToProgressIndex("RENDER_QUEUED"), 2);
  assert.equal(briefStatusToProgressIndex("RENDERING"), 3);
  assert.equal(briefStatusToProgressIndex("QA_PENDING"), 4);
  assert.equal(briefStatusToProgressIndex("PUBLISHED"), 4);
});

test("bucketBriefForParentSummary: 用于父级聚合「ready/generating/failed/waiting」", () => {
  assert.equal(bucketBriefForParentSummary("RENDER_SUCCEEDED"), "ready");
  assert.equal(bucketBriefForParentSummary("PUBLISHED"), "ready");
  assert.equal(bucketBriefForParentSummary("RENDERING"), "generating");
  assert.equal(bucketBriefForParentSummary("RENDER_QUEUED"), "generating");
  assert.equal(bucketBriefForParentSummary("RENDER_FAILED"), "failed");
  assert.equal(bucketBriefForParentSummary("QA_REJECTED"), "failed");
  assert.equal(bucketBriefForParentSummary("BRIEF_PENDING"), "waiting");
  assert.equal(bucketBriefForParentSummary("SCRIPT_READY"), "waiting");
});

test("friendlySubmitError: 把 admin error 翻成客户友好的中文", () => {
  const out = friendlySubmitError("Seedance 提交失败: 429 rate limited");
  assert.match(out, /稍后再试/);
  assert.ok(!out.includes("429"), "不能把 HTTP code 暴露给客户");
});

test("friendlyProviderError: expired/cancelled 给清晰的「重试」引导", () => {
  const expired = friendlyProviderError("expired");
  assert.match(expired, /重试|过期/);
  const policy = friendlyProviderError("failed", "Content policy violation: nsfw");
  assert.match(policy, /内容安全|审核/);
});
