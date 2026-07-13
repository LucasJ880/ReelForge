/**
 * Phase 2 — Business Status Adapter
 *
 * 把内部状态机（VideoBriefStatus / FinalVideoStatus / VideoJobStatus）
 * 映射成 5 个面向 B 端用户的简化状态。Business UI 只暴露这 5 态，
 * 内部 enum 不直接外露（避免出现「RENDER_QUEUED」「STITCHING」这种内部术语）。
 */

import {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";

export type BusinessVideoStatus =
  | "planning"
  | "generating"
  | "assembling"
  | "ready"
  | "failed";

export interface BusinessStatusInput {
  briefStatus?: VideoBriefStatus | null;
  finalVideoStatus?: FinalVideoStatus | null;
  /// 已成功 / 总段数（>0 时 segments 已开始处理）
  segmentsSucceeded?: number;
  segmentsTotal?: number;
  jobStatuses?: VideoJobStatus[];
  /// 在飞段的 provider 真实进度（0-100 平均值；provider 未上报时为 null/undefined）。
  /// INV-5：有真实值时优先用，绝不让前端定时器伪造进度。
  runningProviderProgress?: number | null;
  /// 在飞段中最早一段的已运行时长（ms）。provider 不给 progress 时，
  /// 用它做「随轮询/时间推进」的段内估算（服务端每次渲染重算，单调不减）。
  runningElapsedMs?: number | null;
}

export interface BusinessStatusOutput {
  status: BusinessVideoStatus;
  /// 客户可见的中文长文案（不含任何内部术语）
  label: string;
  /// 客户可见的中文短标签（≤4 字，给状态徽章用）
  shortLabel: string;
  /// 0..1，进度条参考。generating 阶段按真实段完成数插值；
  /// assembling 阶段区分「排队等待合成」(0.85) 与「合成执行中」(0.9)
  progressHint: number;
  /// 客户可执行的下一步动作文案（null 表示无 CTA，状态本身就是终态展示）
  cta: string | null;
  /// assembling 的真实子阶段：waiting = 段已全部生成、在排队等待合成开始；
  /// active = 合成已被领取正在执行。其他状态为 null。
  /// UI 据此展示真话（"排队等待合成" vs "正在合成"），不做假动画。
  assemblingPhase: "waiting" | "active" | null;
}

const LABELS: Record<BusinessVideoStatus, string> = {
  planning: "正在准备您的视频",
  generating: "AI 正在生成画面",
  assembling: "正在合成最终视频",
  ready: "视频已就绪",
  failed: "视频未能成功生成，请重新生成或联系客服",
};

const SHORT_LABELS: Record<BusinessVideoStatus, string> = {
  planning: "筹备中",
  generating: "生成中",
  assembling: "合成中",
  ready: "已完成",
  failed: "未成功",
};

const CTAS: Record<BusinessVideoStatus, string | null> = {
  planning: null,
  generating: null,
  assembling: null,
  ready: "查看最终视频",
  failed: "重新生成",
};

const PROGRESS_HINT: Record<BusinessVideoStatus, number> = {
  planning: 0.1,
  generating: 0.55,
  assembling: 0.85,
  ready: 1,
  failed: 0,
};

/// 凡是出现在客户可见字符串里就视为 leak 的内部术语。
/// 用于自检和测试，确保我们不会把内部模块名/技术词暴露给 B 端用户。
const BANNED_CUSTOMER_TERMS = [
  "渲染",
  "拼接",
  "拉流",
  "ffmpeg",
  "seedance",
  "provider",
  "stitch",
  "concat",
  "blob",
  "mock",
  "adapter",
  "debug",
  "json",
  "executor",
  "pipeline",
] as const;

/**
 * 主入口：综合 brief / finalVideo / jobs 三层状态决定 user-facing status。
 *
 * 优先级（高 → 低）：
 *   1. 任何层显示 failed → failed
 *   2. finalVideo READY / brief 已发布相关 → ready
 *   3. finalVideo STITCHING → assembling
 *   4. finalVideo PENDING + 所有 AI segment SUCCEEDED → assembling
 *   5. brief RENDERING / RENDER_QUEUED 或任何 job 在 QUEUED/RUNNING → generating
 *   6. brief BRIEF_PENDING / SCRIPT_* / SCENE_PROMPT_READY → planning
 *   7. 兜底 → planning
 */
export function deriveBusinessStatus(
  input: BusinessStatusInput,
): BusinessStatusOutput {
  const status = pickStatus(input);
  const assemblingPhase =
    status === "assembling"
      ? input.finalVideoStatus === FinalVideoStatus.STITCHING
        ? "active"
        : "waiting"
      : null;
  return {
    status,
    label:
      status === "assembling" && assemblingPhase === "waiting"
        ? "画面已生成，正在排队合成"
        : LABELS[status],
    shortLabel: SHORT_LABELS[status],
    progressHint: computeProgressHint(status, assemblingPhase, input),
    cta: CTAS[status],
    assemblingPhase,
  };
}

/// 段内时间估算的期望时长（分钟）：elapsed / expected 线性推进、封顶 SEGMENT_INTRA_CAP。
/// 只在 provider 未上报真实 progress 时使用；可配置以贴合模型的实际生成耗时。
const SEGMENT_EXPECTED_MIN = () =>
  Number(process.env.PROGRESS_SEGMENT_EXPECTED_MIN ?? "6");
/// 段内估算封顶：估算永远到不了 100%，真实完成信号（段 SUCCEEDED）才能推满
const SEGMENT_INTRA_CAP = 0.95;

/**
 * 进度值来自流水线真实状态，不是假动画（INV-5）：
 * - generating：0.2 起步，按「(已成功段数 + 当前段内进度) / 总段数」插值到 0.8。
 *   段内进度优先用 provider 上报的真实 progress；provider 不给时用
 *   「已运行时长 / 期望时长」估算（每次轮询/渲染重算 → 随时间单调推进，
 *   封顶 0.95 段，杜绝 2026-07 事故里单段视频恒 20% 的死进度条）。
 * - assembling：排队等待 0.85，合成执行中 0.9（两者含义不同，UI 有对应文案）
 * - 其余状态用静态基准值
 */
function computeProgressHint(
  status: BusinessVideoStatus,
  assemblingPhase: "waiting" | "active" | null,
  input: BusinessStatusInput,
): number {
  if (status === "generating") {
    const {
      segmentsSucceeded = 0,
      segmentsTotal = 0,
      runningProviderProgress,
      runningElapsedMs,
    } = input;
    if (segmentsTotal > 0) {
      /// 段内进度（0..SEGMENT_INTRA_CAP）：真实值优先，其次时间估算，都没有则 0
      let intra = 0;
      if (
        typeof runningProviderProgress === "number" &&
        runningProviderProgress > 0
      ) {
        intra = Math.min(runningProviderProgress / 100, SEGMENT_INTRA_CAP);
      } else if (typeof runningElapsedMs === "number" && runningElapsedMs > 0) {
        intra = Math.min(
          runningElapsedMs / (SEGMENT_EXPECTED_MIN() * 60_000),
          SEGMENT_INTRA_CAP,
        );
      }
      const hasRunning = segmentsSucceeded < segmentsTotal;
      const effective = segmentsSucceeded + (hasRunning ? intra : 0);
      const ratio = Math.min(Math.max(effective / segmentsTotal, 0), 1);
      return 0.2 + 0.6 * ratio;
    }
    return PROGRESS_HINT.generating;
  }
  if (status === "assembling") {
    return assemblingPhase === "active" ? 0.9 : 0.85;
  }
  return PROGRESS_HINT[status];
}

/**
 * 页面辅助：把 brief 的 videoJobs 汇总成 computeProgressHint 需要的段内进度输入。
 * - runningProviderProgress：在飞段 lastProgress 的最大值（多段并行时取推进最快的）
 * - runningElapsedMs：在飞段中最早 submittedAt 距 now 的时长
 */
export function summarizeRunningJobs(
  jobs: Array<{
    status: VideoJobStatus;
    lastProgress?: number | null;
    submittedAt?: Date | null;
  }>,
  now: Date = new Date(),
): Pick<BusinessStatusInput, "runningProviderProgress" | "runningElapsedMs"> {
  const running = jobs.filter(
    (j) =>
      j.status === VideoJobStatus.RUNNING || j.status === VideoJobStatus.QUEUED,
  );
  if (running.length === 0) {
    return { runningProviderProgress: null, runningElapsedMs: null };
  }
  const progresses = running
    .map((j) => j.lastProgress)
    .filter((p): p is number => typeof p === "number" && p > 0);
  const earliest = running.reduce<number | null>((min, j) => {
    const t = j.submittedAt?.getTime() ?? null;
    if (t == null) return min;
    return min == null ? t : Math.min(min, t);
  }, null);
  return {
    runningProviderProgress:
      progresses.length > 0 ? Math.max(...progresses) : null,
    runningElapsedMs: earliest != null ? Math.max(0, now.getTime() - earliest) : null,
  };
}

/**
 * 判断字符串是否含有 customer 不应该看到的内部术语。
 * 用于测试 / CI 守门，也用于运行时过滤要展示给客户的错误文案
 * （含内部术语的技术错误退回通用文案，不外露）。
 */
export function containsBannedCustomerTerm(input: string): boolean {
  const lower = input.toLowerCase();
  return BANNED_CUSTOMER_TERMS.some((t) => lower.includes(t.toLowerCase()));
}

function pickStatus(input: BusinessStatusInput): BusinessVideoStatus {
  const {
    briefStatus,
    finalVideoStatus,
    segmentsSucceeded = 0,
    segmentsTotal = 0,
    jobStatuses = [],
  } = input;

  /// 1. failed 短路
  if (finalVideoStatus === FinalVideoStatus.FAILED) return "failed";
  if (
    briefStatus === VideoBriefStatus.RENDER_FAILED ||
    briefStatus === VideoBriefStatus.QA_REJECTED ||
    briefStatus === VideoBriefStatus.DROPPED
  ) {
    return "failed";
  }
  if (
    jobStatuses.length > 0 &&
    jobStatuses.every((s) => s === VideoJobStatus.FAILED)
  ) {
    return "failed";
  }

  /// 2. ready —— QA_PENDING 也算 ready：video-service 在 finalVideoUrl 写完后才置 QA_PENDING
  if (finalVideoStatus === FinalVideoStatus.READY) return "ready";
  if (
    briefStatus === VideoBriefStatus.QA_PENDING ||
    briefStatus === VideoBriefStatus.QA_APPROVED ||
    briefStatus === VideoBriefStatus.PUBLISH_PENDING ||
    briefStatus === VideoBriefStatus.PUBLISHED ||
    briefStatus === VideoBriefStatus.METRICS_COLLECTING ||
    briefStatus === VideoBriefStatus.SCORED ||
    briefStatus === VideoBriefStatus.ARCHIVED
  ) {
    return "ready";
  }

  /// 3. STITCHING
  if (finalVideoStatus === FinalVideoStatus.STITCHING) return "assembling";

  /// 4. final 还在 PENDING 但所有 AI segment 都好了 → 已经在等拼接
  if (
    finalVideoStatus === FinalVideoStatus.PENDING &&
    segmentsTotal > 0 &&
    segmentsSucceeded === segmentsTotal
  ) {
    return "assembling";
  }

  /// 5. RENDERING / RENDER_QUEUED 或任意 job 在 QUEUED/RUNNING
  if (
    briefStatus === VideoBriefStatus.RENDERING ||
    briefStatus === VideoBriefStatus.RENDER_QUEUED ||
    briefStatus === VideoBriefStatus.RENDER_SUCCEEDED
  ) {
    return "generating";
  }
  if (
    jobStatuses.some(
      (s) => s === VideoJobStatus.QUEUED || s === VideoJobStatus.RUNNING,
    )
  ) {
    return "generating";
  }

  /// 6. brief 还在规划阶段
  if (
    briefStatus === VideoBriefStatus.BRIEF_PENDING ||
    briefStatus === VideoBriefStatus.SCRIPT_DRAFTING ||
    briefStatus === VideoBriefStatus.SCRIPT_READY ||
    briefStatus === VideoBriefStatus.SCENE_PROMPT_READY
  ) {
    return "planning";
  }

  /// INV-4：走到这里且 briefStatus 非空 = 未被上面任何分支识别的未知状态
  /// （枚举漂移 / 序列化异常）。宁可显示失败 + 重试入口，也不假装「生成中」。
  if (briefStatus != null) return "failed";

  /// briefStatus 为空（订单尚未创建 brief）→ 仍是规划阶段
  return "planning";
}

export const __test__ = {
  pickStatus,
  LABELS,
  SHORT_LABELS,
  CTAS,
  PROGRESS_HINT,
  BANNED_CUSTOMER_TERMS,
};
