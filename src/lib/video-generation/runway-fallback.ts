import { parseDirectorPlan, type DirectorPlan } from "@/lib/schemas/director-plan";
import type { VideoGenerationPlan } from "@/types/video-generation";
import { mapPlanToDirectorPlan } from "./plan-to-director";

/**
 * Runway 拒单自动改交 Shuyu 的纯规则（2026-10-28 晚 Evan「做回退」）。
 *
 * 灰度真机里 Kling 的提交被 400 拒（提示词超 2500 字），派发直接报 PROVIDER_ERROR，商家只看到「请联系支持」；
 * 更早 Seedance 2.5 在任务里把含人脸的参考图整单拦下。Runway 拒了，这条视频就改交 Shuyu 拍，商家照常等成片。
 *
 * 只在「Runway 没收这单的钱、这条视频也没有任何一段还用得上」时换线路：
 *  - 提交被拒：REJECTED + definitely_not_created（4xx / 本地预检），Runway 侧根本没建任务；
 *  - 任务失败：Runway 受理后自己回报 FAILED（审核拦截、内部错误……），失败的任务不计费。
 * 拿不准的一律不换：ACK_UNKNOWN / 提交中 / 超时判死 / 僵死判死（Runway 可能还在跑，换了两家都收钱）；
 * 有段已经成功或还在跑（同一条成片的前后段会出自两家）；客户取消过（CANCELLED 不是 FAILED）。
 */

/** reconcileVideoJob 记「供应商自己回报失败」的 errorMessage 前缀 */
export const PROVIDER_FAILED_ERROR_PREFIX = "[provider:failed]";

export type RunwayFallbackJob = {
  status: string;
  submissionState: string;
  submissionErrorClass: string | null;
  externalJobId: string | null;
  errorMessage: string | null;
  lastProviderStatus: string | null;
  videoProviderAdapterSnapshot: string | null;
};

export type RunwayFallbackTrigger = "submit_rejected" | "provider_failed";

export type RunwayFallbackDecision =
  | { fallback: true; trigger: RunwayFallbackTrigger }
  | { fallback: false; reason: "no_jobs" | "not_runway" | "still_usable" | "uncertain" };

function rejectedBeforeCreation(job: RunwayFallbackJob): boolean {
  return (
    job.status === "FAILED" &&
    job.submissionState === "REJECTED" &&
    job.externalJobId == null &&
    (job.submissionErrorClass ?? "").startsWith("definitely_not_created:")
  );
}

function failedByProvider(job: RunwayFallbackJob): boolean {
  return (
    job.status === "FAILED" &&
    job.submissionState === "ACCEPTED" &&
    job.externalJobId != null &&
    (job.errorMessage ?? "").startsWith(PROVIDER_FAILED_ERROR_PREFIX) &&
    job.lastProviderStatus?.trim().toUpperCase() === "FAILED"
  );
}

/** 这条视频的当前段（isCurrentSegmentJob）够不够格整条改交 Shuyu */
export function runwayFallbackDecision(currentJobs: readonly RunwayFallbackJob[]): RunwayFallbackDecision {
  if (currentJobs.length === 0) return { fallback: false, reason: "no_jobs" };
  if (currentJobs.some((job) => job.videoProviderAdapterSnapshot !== "runway")) {
    return { fallback: false, reason: "not_runway" };
  }
  if (currentJobs.some((job) => job.status !== "FAILED")) return { fallback: false, reason: "still_usable" };
  if (currentJobs.every(rejectedBeforeCreation)) return { fallback: true, trigger: "submit_rejected" };
  if (currentJobs.every((job) => rejectedBeforeCreation(job) || failedByProvider(job))) {
    return { fallback: true, trigger: "provider_failed" };
  }
  return { fallback: false, reason: "uncertain" };
}

/**
 * 换线路前把 directorPlan 还原成按故事板改写之前的样子。派发时段提示词按线路改写后写回
 * （Kling 是开场帧版、不带参考图序号），改写带标记、不会二次改写——换到 Shuyu 必须从原版重新改写。
 * 原版就是派发入口那次 mapPlanToDirectorPlan(videoGenerationPlan, language)：brief 上两样都在。
 * 计划缺失、解析不了、分段与已派发的对不上，返回 null（不换线路）。
 */
export function directorPlanBeforeGrounding(brief: {
  directorPlan: unknown;
  videoGenerationPlan: unknown;
}): DirectorPlan | null {
  let current: DirectorPlan;
  let rebuilt: DirectorPlan;
  try {
    current = parseDirectorPlan(brief.directorPlan);
    rebuilt = mapPlanToDirectorPlan({
      plan: brief.videoGenerationPlan as VideoGenerationPlan,
      language: current.language,
    });
  } catch {
    return null;
  }
  const sameSegments =
    rebuilt.segmentPlan.length === current.segmentPlan.length &&
    rebuilt.segmentPlan.every((segment, index) => {
      const dispatched = current.segmentPlan[index];
      return (
        segment.segmentIndex === dispatched.segmentIndex &&
        segment.fromSec === dispatched.fromSec &&
        segment.toSec === dispatched.toSec &&
        segment.durationSec === dispatched.durationSec
      );
    });
  return sameSegments ? rebuilt : null;
}
