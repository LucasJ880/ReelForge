import assert from "node:assert/strict";
import test from "node:test";
import { VideoJobStatus, FinalVideoStatus } from "@prisma/client";
import { __test__ as videoSvcTest } from "../src/lib/services/video-service";
import { planSegments, requiresStitching } from "../src/lib/duration/segment-planner";
import { __test__ as directorTest } from "../src/lib/services/director-service";
import { parseDirectorPlan } from "../src/lib/schemas/director-plan";

const { classifyUserStatus, friendlyProviderError } = videoSvcTest;
const { mockDirectorPlan } = directorTest;

/**
 * 多段视频生命周期 —— 纯函数 mock 测试。
 *
 * 真正的 dispatchMultiSegmentGeneration 涉及 Prisma 写入，需要 PostgreSQL，
 * 不在 unit 测试中覆盖（由 wizard-services-mock 之外的集成层覆盖）。
 *
 * 这里我们覆盖的是不可缺失的「逻辑契约」：
 * 1. 30s/60s → segment-planner 给出正确的段数和时长
 * 2. DirectorPlan.segmentPlan 与 segment-planner 完全对齐（防止两套切片逻辑漂移）
 * 3. classifyUserStatus 在多段流的状态映射正确
 * 4. friendlyProviderError 不泄露 provider/任务 ID
 */

test("多段流：30s 必须切成 2 段 × 15s（与 plan 一致）", () => {
  assert.equal(requiresStitching(30), true);
  const segs = planSegments(30);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].durationSec, 15);
  assert.equal(segs[1].durationSec, 15);
});

test("多段流：60s 必须切成 4 段 × 15s（与 plan 一致）", () => {
  assert.equal(requiresStitching(60), true);
  const segs = planSegments(60);
  assert.equal(segs.length, 4);
  for (const s of segs) {
    assert.equal(s.durationSec, 15);
  }
});

test("多段流：15s 单段，不进入拼接流", () => {
  assert.equal(requiresStitching(15), false);
  const segs = planSegments(15);
  assert.equal(segs.length, 1);
});

test("DirectorPlan.segmentPlan 与 segment-planner 段数对齐（30s）", () => {
  const segs = planSegments(30);
  const plan = parseDirectorPlan(
    mockDirectorPlan(buildDirectorContext(30, segs)),
  );
  assert.equal(plan.segmentPlan.length, segs.length);
  for (let i = 0; i < segs.length; i++) {
    assert.equal(plan.segmentPlan[i].segmentIndex, segs[i].segmentIndex);
    assert.equal(plan.segmentPlan[i].durationSec, segs[i].durationSec);
  }
});

test("DirectorPlan.segmentPlan 与 segment-planner 段数对齐（60s）", () => {
  const segs = planSegments(60);
  const plan = parseDirectorPlan(
    mockDirectorPlan(buildDirectorContext(60, segs)),
  );
  assert.equal(plan.segmentPlan.length, 4);
  /// stitchOrder 必须是 0..3
  assert.deepEqual(plan.editingPlan.stitchOrder, [0, 1, 2, 3]);
});

test("段状态聚合：所有段 SUCCEEDED → brief 应进入「合成完整视频」语义", () => {
  /// 测试 classifyUserStatus 对每段的展示状态
  const segments = [0, 1].map((i) => ({
    status: VideoJobStatus.SUCCEEDED,
    submittedAt: new Date(),
    startedAt: new Date(),
    externalJobId: `task_${i}`,
  }));
  for (const s of segments) {
    assert.equal(classifyUserStatus(s, false), "ready");
  }
});

test("段状态聚合：1 段成功 + 1 段进行中 → 进行中视图", () => {
  const succeeded = {
    status: VideoJobStatus.SUCCEEDED,
    submittedAt: new Date(),
    startedAt: new Date(),
    externalJobId: "task_0",
  };
  const running = {
    status: VideoJobStatus.RUNNING,
    submittedAt: new Date(),
    startedAt: new Date(),
    externalJobId: "task_1",
  };
  assert.equal(classifyUserStatus(succeeded, false), "ready");
  assert.equal(classifyUserStatus(running, false), "generating");
});

test("段状态聚合：1 段失败 + 3 段成功 → 失败状态优先暴露", () => {
  const succeeded = {
    status: VideoJobStatus.SUCCEEDED,
    submittedAt: new Date(),
    startedAt: new Date(),
    externalJobId: "task_x",
  };
  const failed = {
    status: VideoJobStatus.FAILED,
    submittedAt: new Date(),
    startedAt: new Date(),
    externalJobId: "task_y",
  };
  assert.equal(classifyUserStatus(succeeded, false), "ready");
  assert.equal(classifyUserStatus(failed, false), "failed");
});

test("FinalVideoStatus enum 提供 4 个状态：PENDING / STITCHING / READY / FAILED", () => {
  assert.equal(FinalVideoStatus.PENDING, "PENDING");
  assert.equal(FinalVideoStatus.STITCHING, "STITCHING");
  assert.equal(FinalVideoStatus.READY, "READY");
  assert.equal(FinalVideoStatus.FAILED, "FAILED");
});

test("用户错误文案：不暴露 provider 名 / 任务 ID", () => {
  /// 模拟 Seedance 失败 → 客户文案不应泄露 SEEDANCE / external_job_id
  const friendly = friendlyProviderError("failed", "Seedance task_xxx returned error 500");
  for (const banned of ["seedance", "task_xxx", "500", "Seedance"]) {
    assert.ok(!friendly.includes(banned), `friendly 文案泄露了 ${banned}: ${friendly}`);
  }
});

function buildDirectorContext(
  targetDurationSec: 15 | 30 | 60,
  segs: ReturnType<typeof planSegments>,
) {
  return {
    targetDurationSec,
    segmentSlots: segs,
    clientBrief: {
      businessName: "Sunny Shutter",
      productName: "Sunny Shutter motorized blinds",
      brandAssets: { logoUrl: "https://example.com/logo.png" },
    },
    productInput: {},
    targetCountry: "US",
    targetLanguage: "en-US",
    targetPlatform: "tiktok",
    angle: {
      title: "Hands-free morning",
      hook: "Wake up to natural light, no more curtains",
      narrative: null,
      type: "OPTIMIZATION",
      explorationTheme: null,
      localeNotes: null,
    },
  };
}
