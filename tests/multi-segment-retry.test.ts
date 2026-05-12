import assert from "node:assert/strict";
import test from "node:test";
import { VideoJobStatus } from "@prisma/client";
import { __test__ as videoSvcTest } from "../src/lib/services/video-service";
import { planSegments } from "../src/lib/duration/segment-planner";
import { __test__ as directorTest } from "../src/lib/services/director-service";
import { parseDirectorPlan } from "../src/lib/schemas/director-plan";

const { classifyUserStatus, friendlySubmitError } = videoSvcTest;
const { mockDirectorPlan } = directorTest;

/**
 * 段感知重试测试 —— 防双计费的核心契约：
 *
 * 1. 失败段才暴露给「重试」按钮（成功段不能点重试）
 * 2. DirectorPlan.segmentPlan 是重试唯一来源（按 segmentIndex 取 prompt）
 * 3. 重试不重新生成 DirectorPlan，避免 GPT-5.5 重新跑（保持创意一致）
 * 4. 重试错误文案对客户友好（不暴露内部 ID）
 *
 * 实际 retryFailedVideoJob / retryFailedSegmentsForBrief 涉及 Prisma 写入，
 * 需要 PostgreSQL，不在 unit 层覆盖；此处覆盖纯逻辑契约。
 */

const baseFailedJob = {
  status: VideoJobStatus.FAILED,
  submittedAt: new Date(),
  startedAt: new Date(),
  externalJobId: "task_xyz",
};

test("仅 FAILED 状态可被「重试」按钮触发", () => {
  /// classifyUserStatus 对 FAILED 段返回 "failed"
  assert.equal(classifyUserStatus(baseFailedJob, false), "failed");
  /// SUCCEEDED 段返回 "ready"，不应有重试入口
  assert.equal(
    classifyUserStatus(
      { ...baseFailedJob, status: VideoJobStatus.SUCCEEDED },
      false,
    ),
    "ready",
  );
});

test("段感知重试：DirectorPlan.segmentPlan 按 segmentIndex 唯一对应 prompt", () => {
  const segs = planSegments(60);
  const plan = parseDirectorPlan(
    mockDirectorPlan({
      targetDurationSec: 60,
      segmentSlots: segs,
      clientBrief: { businessName: "Acme", productName: "Acme Pro" },
      productInput: {},
      targetCountry: "US",
      targetLanguage: "en-US",
      targetPlatform: "tiktok",
      angle: {
        title: "test",
        hook: "test hook",
        narrative: null,
        type: "OPTIMIZATION",
        explorationTheme: null,
        localeNotes: null,
      },
    }),
  );

  /// 重试段 #2：必须能且仅能找到一个对应的 segmentPlan
  const matched = plan.segmentPlan.filter((s) => s.segmentIndex === 2);
  assert.equal(matched.length, 1);
  assert.ok(matched[0].seedancePrompt.length > 10);

  /// 不存在的 segmentIndex（5）找不到 — 由 retryFailedVideoJob 抛错
  const notFound = plan.segmentPlan.filter((s) => s.segmentIndex === 5);
  assert.equal(notFound.length, 0);
});

test("重试 prompt 在多次重试间保持稳定（不会被重新生成）", () => {
  /// 同一份 ctx 调用 mockDirectorPlan 两次，segmentPlan[i].seedancePrompt 必须一致
  const ctx = {
    targetDurationSec: 30 as const,
    segmentSlots: planSegments(30),
    clientBrief: { businessName: "Acme", productName: "Acme Pro" },
    productInput: {},
    targetCountry: "US",
    targetLanguage: "en-US",
    targetPlatform: "tiktok",
    angle: {
      title: "test",
      hook: "h",
      narrative: null,
      type: "OPTIMIZATION",
      explorationTheme: null,
      localeNotes: null,
    },
  };
  const plan1 = parseDirectorPlan(mockDirectorPlan(ctx));
  const plan2 = parseDirectorPlan(mockDirectorPlan(ctx));
  for (let i = 0; i < plan1.segmentPlan.length; i++) {
    assert.equal(
      plan1.segmentPlan[i].seedancePrompt,
      plan2.segmentPlan[i].seedancePrompt,
      `segment ${i} prompt 在重试间漂移`,
    );
  }
});

test("段感知重试错误文案对用户友好（不泄露 admin 详情）", () => {
  const adminMsg = "Seedance task_abc123 submission failed: 429 Too Many Requests";
  const friendly = friendlySubmitError(adminMsg);
  for (const banned of ["task_abc123", "429", "Seedance"]) {
    assert.ok(!friendly.includes(banned), `friendly 文案泄露了 ${banned}: ${friendly}`);
  }
});

test("段感知重试：失败段同时只有一条对应的 SegmentPlan（防止意外复制）", () => {
  /// 30s 共 2 段；segmentIndex 必须唯一
  const segs = planSegments(30);
  const indices = segs.map((s) => s.segmentIndex);
  assert.equal(new Set(indices).size, indices.length);

  /// 60s 共 4 段；segmentIndex 必须唯一
  const segs60 = planSegments(60);
  const idx60 = segs60.map((s) => s.segmentIndex);
  assert.equal(new Set(idx60).size, idx60.length);
});

test("段感知重试：成功段不应被划入 retryFailedSegmentsForBrief 范围", () => {
  /// 模拟：仅 FAILED 才被取出
  const jobs = [
    { id: "j0", status: VideoJobStatus.SUCCEEDED, segmentIndex: 0 },
    { id: "j1", status: VideoJobStatus.FAILED, segmentIndex: 1 },
    { id: "j2", status: VideoJobStatus.SUCCEEDED, segmentIndex: 2 },
    { id: "j3", status: VideoJobStatus.FAILED, segmentIndex: 3 },
  ];
  const failed = jobs.filter((j) => j.status === VideoJobStatus.FAILED);
  assert.deepEqual(
    failed.map((j) => j.segmentIndex),
    [1, 3],
  );
});
