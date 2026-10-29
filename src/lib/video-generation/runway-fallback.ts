import { parseDirectorPlan, type DirectorPlan } from "@/lib/schemas/director-plan";
import type { VideoGenerationPlan } from "@/types/video-generation";
import { mapPlanToDirectorPlan } from "./plan-to-director";

/**
 * Runway ⇄ Shuyu 互为备用的纯规则（2026-10-28 晚 Runway 拒单改交 Shuyu；10-29 Evan：Shuyu 是默认线路，
 * Shuyu 生成失败再换 Runway）。
 *
 * 灰度真机里 Kling 的提交被 400 拒（提示词超 2500 字），派发直接报 PROVIDER_ERROR，商家只看到「请联系支持」；
 * 更早 Seedance 2.5 在任务里把含人脸的参考图整单拦下。一家拒了，这条视频就改交另一家拍，商家照常等成片。
 *
 * 只在「主线路没收这单的钱、这条视频也没有任何一段还用得上」时换线路：
 *  - 提交被拒：REJECTED + definitely_not_created，供应商侧根本没建任务。Runway 连本地预检也算（超 2500 字，
 *    Shuyu 收得下）；Shuyu 的本地预检不算——那里跑的是我们自己的内容审核，Runway 适配器不审，换线路等于绕过审核；
 *  - 任务失败：受理后供应商自己回报失败、且这一单不计费：Runway 回 FAILED；Shuyu 回 refunded（积分已退回。
 *    failed / refund_pending / refund_error 在适配器里仍算处理中，不会走到这里）。
 * 拿不准的一律不换：ACK_UNKNOWN / 提交中 / 超时判死 / 僵死判死（主线路可能还在跑，换了两家都收钱）；
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
  | { fallback: false; reason: "no_jobs" | "not_runway" | "not_shuyu" | "still_usable" | "uncertain" };

/** 主线路的适配器：runway（备用 Shuyu）或 shuyu（备用 Runway） */
export type RouteFallbackPrimary = "runway" | "shuyu";

/// 供应商「自己说失败、且不计费」的终态（大写比较）
const PROVIDER_FAILED_STATUS: Record<RouteFallbackPrimary, string> = { runway: "FAILED", shuyu: "REFUNDED" };

function rejectedBeforeCreation(job: RunwayFallbackJob, primary: RouteFallbackPrimary): boolean {
  const errorClass = job.submissionErrorClass ?? "";
  return (
    job.status === "FAILED" &&
    job.submissionState === "REJECTED" &&
    job.externalJobId == null &&
    errorClass.startsWith("definitely_not_created:") &&
    !(primary === "shuyu" && errorClass === "definitely_not_created:preflight")
  );
}

function failedByProvider(job: RunwayFallbackJob, primary: RouteFallbackPrimary): boolean {
  return (
    job.status === "FAILED" &&
    job.submissionState === "ACCEPTED" &&
    job.externalJobId != null &&
    (job.errorMessage ?? "").startsWith(PROVIDER_FAILED_ERROR_PREFIX) &&
    job.lastProviderStatus?.trim().toUpperCase() === PROVIDER_FAILED_STATUS[primary]
  );
}

/** 这条视频的当前段（isCurrentSegmentJob）够不够格整条改交备用线路 */
export function routeFallbackDecision(
  currentJobs: readonly RunwayFallbackJob[],
  primary: RouteFallbackPrimary,
): RunwayFallbackDecision {
  if (currentJobs.length === 0) return { fallback: false, reason: "no_jobs" };
  if (currentJobs.some((job) => job.videoProviderAdapterSnapshot !== primary)) {
    return { fallback: false, reason: primary === "runway" ? "not_runway" : "not_shuyu" };
  }
  if (currentJobs.some((job) => job.status !== "FAILED")) return { fallback: false, reason: "still_usable" };
  if (currentJobs.every((job) => rejectedBeforeCreation(job, primary))) return { fallback: true, trigger: "submit_rejected" };
  if (currentJobs.every((job) => rejectedBeforeCreation(job, primary) || failedByProvider(job, primary))) {
    return { fallback: true, trigger: "provider_failed" };
  }
  return { fallback: false, reason: "uncertain" };
}

/** Runway 主线路的判据（10-28 原版） */
export function runwayFallbackDecision(currentJobs: readonly RunwayFallbackJob[]): RunwayFallbackDecision {
  return routeFallbackDecision(currentJobs, "runway");
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
