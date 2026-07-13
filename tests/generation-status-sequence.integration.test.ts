import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "../src/lib/db";
import {
  reconcileVideoJob,
  __test__ as videoSvcTest,
} from "../src/lib/services/video-service";
import {
  deriveBusinessStatus,
  type BusinessVideoStatus,
} from "../src/lib/video-generation/business-status";
import { derivePersonalStatus } from "../src/lib/video-generation/personal-status";
import type { SeedanceJobResult } from "../src/lib/providers/seedance";

/**
 * AC-2 —— 完整生成流程的状态序列集成测试。
 *
 * 用注入的 Provider 序列（processing 20% → processing 70% → completed）驱动
 * 真实的 reconcileVideoJob 状态机（Prisma 内存 mock），每一步把 DB 快照投影成
 * 前端可见状态，断言：
 *   1. 序列合法：planning → generating(阶段递进) → assembling → ready
 *   2. 无状态回退（rank 单调不减）
 *   3. generating 阶段进度随轮询严格递增（真实 provider progress 驱动）
 */

process.env.FRAME_QA_DISABLED = "true";

const RANK: Record<BusinessVideoStatus, number> = {
  planning: 0,
  generating: 1,
  assembling: 2,
  ready: 3,
  failed: 99,
};

type JobRow = Record<string, unknown> & {
  id: string;
  status: VideoJobStatus;
  lastProgress: number | null;
};

test("AC-2 集成：完整生成的前端可见状态序列合法，无回退，进度递进", async (t: TestContext) => {
  const NOW = Date.now();
  /// ---- 内存 DB：单段 15s personal 视频 ----
  const job: JobRow = {
    id: "job_seq",
    videoBriefId: "brief_seq",
    externalJobId: "ext_seq",
    status: VideoJobStatus.RUNNING,
    provider: VideoProvider.SEEDANCE_T2V,
    pollErrors: 0,
    retryCount: 0,
    timeoutAt: new Date(NOW + 10 * 60_000),
    submittedAt: new Date(NOW),
    startedAt: new Date(NOW),
    finishedAt: null,
    lastCheckedAt: null,
    lastProviderStatus: "running",
    lastProgress: null,
    errorMessage: null,
    userSafeError: null,
    outputVideoUrl: null,
    outputThumbUrl: null,
    /// STITCHING 状态的 finalVideo：maybeTriggerStitch 提前返回，不触真实 stitch
    finalVideoId: "fv_seq",
    createdAt: new Date(NOW),
  };

  const jobModel = db.videoJob as unknown as Record<string, unknown>;
  const fvModel = db.finalVideo as unknown as Record<string, unknown>;
  const originals = {
    findUnique: jobModel.findUnique,
    update: jobModel.update,
    updateMany: jobModel.updateMany,
    fvFindUnique: fvModel.findUnique,
  };
  jobModel.findUnique = async () => ({ ...job });
  jobModel.update = async (args: { data: Partial<JobRow> }) => {
    Object.assign(job, args.data);
    return { ...job };
  };
  jobModel.updateMany = async (args: {
    where: { status?: { in?: VideoJobStatus[] } };
    data: Partial<JobRow>;
  }) => {
    const allowed = args.where.status?.in;
    if (allowed && !allowed.includes(job.status)) return { count: 0 };
    Object.assign(job, args.data);
    return { count: 1 };
  };
  fvModel.findUnique = async () => ({
    id: "fv_seq",
    status: FinalVideoStatus.STITCHING,
    segmentCount: 1,
    segments: [{ status: job.status }],
  });
  t.after(() => {
    jobModel.findUnique = originals.findUnique;
    jobModel.update = originals.update;
    jobModel.updateMany = originals.updateMany;
    fvModel.findUnique = originals.fvFindUnique;
    videoSvcTest.__setStatusFetcherForTests(null);
  });

  /// ---- Provider 响应序列（updated_at 推进 → 不触发僵死判定） ----
  const createdSec = Math.floor(NOW / 1000);
  const providerSequence: SeedanceJobResult[] = [
    {
      jobId: "ext_seq",
      status: "processing",
      rawProviderStatus: "running",
      progress: 20,
      rawProviderResponse: { created_at: createdSec, updated_at: createdSec + 30 },
    },
    {
      jobId: "ext_seq",
      status: "processing",
      rawProviderStatus: "running",
      progress: 70,
      rawProviderResponse: { created_at: createdSec, updated_at: createdSec + 90 },
    },
    {
      jobId: "ext_seq",
      status: "completed",
      rawProviderStatus: "succeeded",
      videoUrl: "https://example.com/seq.mp4",
    },
  ];
  let pollIndex = 0;
  videoSvcTest.__setStatusFetcherForTests((async () => {
    const r = providerSequence[Math.min(pollIndex, providerSequence.length - 1)];
    pollIndex++;
    return r;
  }) as never);

  /// ---- 采样前端投影 ----
  const seen: Array<{ status: BusinessVideoStatus; progress: number; step: string }> = [];
  function snapshot(step: string, input: Parameters<typeof deriveBusinessStatus>[0]) {
    const business = deriveBusinessStatus(input);
    const personal = derivePersonalStatus(input);
    assert.equal(personal.status, business.status, "B/C 端状态机必须一致（INV-4）");
    seen.push({ status: business.status, progress: business.progressHint, step });
  }

  /// step 0: 用户刚提交，brief 还在规划
  snapshot("planning", { briefStatus: VideoBriefStatus.SCENE_PROMPT_READY });

  /// step 1: dispatch 后排队
  snapshot("queued", {
    briefStatus: VideoBriefStatus.RENDER_QUEUED,
    segmentsSucceeded: 0,
    segmentsTotal: 1,
    jobStatuses: [VideoJobStatus.QUEUED],
  });

  /// step 2-3: 两次轮询（真实 provider progress 20 → 70）
  for (const step of ["poll-20", "poll-70"]) {
    await reconcileVideoJob(job.id);
    assert.equal(job.status, VideoJobStatus.RUNNING);
    snapshot(step, {
      briefStatus: VideoBriefStatus.RENDERING,
      finalVideoStatus: FinalVideoStatus.PENDING,
      segmentsSucceeded: 0,
      segmentsTotal: 1,
      jobStatuses: [job.status],
      runningProviderProgress: job.lastProgress,
      runningElapsedMs: 60_000,
    });
  }

  /// step 4: 第三次轮询 → 段完成 → 等待/执行合成
  await reconcileVideoJob(job.id);
  assert.equal(job.status, VideoJobStatus.SUCCEEDED, "provider completed 必须落 SUCCEEDED");
  snapshot("assembling", {
    briefStatus: VideoBriefStatus.RENDERING,
    finalVideoStatus: FinalVideoStatus.STITCHING,
    segmentsSucceeded: 1,
    segmentsTotal: 1,
    jobStatuses: [job.status],
  });

  /// step 5: 拼接完成
  snapshot("ready", {
    briefStatus: VideoBriefStatus.QA_PENDING,
    finalVideoStatus: FinalVideoStatus.READY,
    segmentsSucceeded: 1,
    segmentsTotal: 1,
    jobStatuses: [VideoJobStatus.SUCCEEDED],
  });

  /// ---- 断言 1：序列合法（依次经过 4 个用户可见阶段，无 failed） ----
  const distinct = [...new Set(seen.map((s) => s.status))];
  assert.deepEqual(
    distinct,
    ["planning", "generating", "assembling", "ready"],
    `状态序列必须是 planning → generating → assembling → ready，实际: ${distinct.join(" → ")}`,
  );

  /// ---- 断言 2：无状态回退 ----
  for (let i = 1; i < seen.length; i++) {
    assert.ok(
      RANK[seen[i].status] >= RANK[seen[i - 1].status],
      `状态回退: ${seen[i - 1].step}(${seen[i - 1].status}) → ${seen[i].step}(${seen[i].status})`,
    );
  }

  /// ---- 断言 3：进度单调不减，且 generating 阶段随轮询严格递增 ----
  for (let i = 1; i < seen.length; i++) {
    assert.ok(
      seen[i].progress >= seen[i - 1].progress,
      `进度回退: ${seen[i - 1].step}(${seen[i - 1].progress}) → ${seen[i].step}(${seen[i].progress})`,
    );
  }
  const poll20 = seen.find((s) => s.step === "poll-20")!;
  const poll70 = seen.find((s) => s.step === "poll-70")!;
  assert.ok(
    poll70.progress > poll20.progress,
    "generating 阶段进度必须随真实 provider progress 递进（不允许恒定值）",
  );

  /// ---- 断言 4：provider 真实 progress 已持久化（INV-5） ----
  assert.equal(job.lastProgress, 70, "轮询必须把 provider 真实进度写进 DB");
});
