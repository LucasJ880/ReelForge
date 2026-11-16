import assert from "node:assert/strict";
import test from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { __test__ } from "../src/lib/services/video-service";

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
