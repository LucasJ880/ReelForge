import { classifyCustomerGenerationError } from "@/lib/api/customer-generation-error";
import type { CustomerGenerationError } from "@/lib/api/customer-generation-error";
import {
  machineVideoConfirmationPath,
  machineVideoTaskViewSchema,
  type MachineVideoTaskView,
} from "@/lib/contracts/machine-video-api";
import { isCurrentSegmentJob } from "@/lib/video-generation/segment-redo";

export interface MachineVideoStatusJob {
  status: string;
  submissionState?: string | null;
  submissionErrorClass?: string | null;
  errorMessage?: string | null;
  userSafeError?: string | null;
  outputVideoUrl?: string | null;
  replacesJobId?: string | null;
  supersededAt?: Date | string | null;
  finalVideoId?: string | null;
}

export interface MachineVideoStatusSnapshot {
  taskId: string;
  viewerUserId: string;
  storyboard: {
    status: string;
    frameStatuses?: readonly string[];
  } | null;
  brief: {
    id: string;
    ownerUserId: string;
    status?: string | null;
    brandedVideoUrl: string | null;
    brandedAt: Date | string | null;
    takedownAt: Date | string | null;
    finalVideoUrl?: string | null;
  } | null;
  finalVideo: {
    status: "PENDING" | "STITCHING" | "READY" | "FAILED" | string;
  } | null;
  jobs: readonly MachineVideoStatusJob[];
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function failureOf(
  error: CustomerGenerationError | null,
  fallback: CustomerGenerationError,
): MachineVideoTaskView["failure"] {
  const source = error ?? fallback;
  return {
    code: source.code,
    message: source.message,
    retryable: source.retryable,
    action: source.action,
  };
}

function view(input: Omit<MachineVideoTaskView, "ok" | "confirmationPath"> & { taskId: string }): MachineVideoTaskView {
  return machineVideoTaskViewSchema.parse({
    ok: true,
    confirmationPath: machineVideoConfirmationPath(input.taskId),
    ...input,
  });
}

/**
 * 把故事板 / 视频任务投影成稳定状态。
 * 故事板帧成功、未封装的成片地址都不算出可交付。
 * 供应商任务号和原始错误不进入结果。
 */
export function projectMachineVideoTask(snapshot: MachineVideoStatusSnapshot): MachineVideoTaskView {
  const briefIsForeign =
    snapshot.brief != null && snapshot.brief.ownerUserId !== snapshot.viewerUserId;
  const currentJobs = (briefIsForeign ? [] : snapshot.jobs).filter((job) => isCurrentSegmentJob(job));
  const briefOwned = briefIsForeign ? null : snapshot.brief;
  const started = briefOwned != null || currentJobs.length > 0;
  const briefId = started ? briefOwned?.id ?? null : null;

  if (briefOwned?.takedownAt) {
    return view({
      taskId: snapshot.taskId,
      briefId,
      status: "cancelled",
      stage: "taken_down",
      started: true,
      deliverableUrl: null,
      failure: {
        code: "FORBIDDEN",
        message: "成片已从交付中撤回。",
        retryable: false,
        action: "contact_support",
      },
    });
  }

  const unsafe = currentJobs.find((job) => {
    const classified = classifyCustomerGenerationError({
      status: job.status,
      submissionState: job.submissionState,
      submissionErrorClass: job.submissionErrorClass,
      errorMessage: job.errorMessage,
      userSafeError: job.userSafeError,
    });
    return classified?.code === "SUBMISSION_ACK_UNKNOWN";
  });
  if (unsafe) {
    return view({
      taskId: snapshot.taskId,
      briefId,
      status: "failed",
      stage: "video_ack_unknown",
      started: true,
      deliverableUrl: null,
      failure: failureOf(
        classifyCustomerGenerationError({
          status: "FAILED",
          submissionState: "ACK_UNKNOWN",
        }),
        {
          code: "SUBMISSION_ACK_UNKNOWN",
          message: "生成服务可能已接收任务。系统已停止重复提交以避免重复计费，请联系支持核对。",
          retryable: false,
          action: "contact_support",
        },
      ),
    });
  }

  const branded = briefOwned?.brandedAt ? httpUrl(briefOwned.brandedVideoUrl) : null;
  if (branded) {
    return view({
      taskId: snapshot.taskId,
      briefId,
      status: "deliverable",
      stage: "deliverable",
      started: true,
      deliverableUrl: branded,
      failure: null,
    });
  }

  if (currentJobs.some((job) => job.status === "RUNNING")) {
    return view({
      taskId: snapshot.taskId,
      briefId,
      status: "running",
      stage: "video_running",
      started: true,
      deliverableUrl: null,
      failure: null,
    });
  }
  if (currentJobs.some((job) => job.status === "QUEUED" || job.status === "PAUSED")) {
    return view({
      taskId: snapshot.taskId,
      briefId,
      status: "queued",
      stage: "video_queued",
      started: true,
      deliverableUrl: null,
      failure: null,
    });
  }

  const failedJob = currentJobs.find((job) => job.status === "FAILED");
  if (failedJob || briefOwned?.status === "RENDER_FAILED") {
    return view({
      taskId: snapshot.taskId,
      briefId,
      status: "failed",
      stage: "video_failed",
      started: true,
      deliverableUrl: null,
      failure: failureOf(
        failedJob
          ? classifyCustomerGenerationError({
              status: failedJob.status,
              submissionState: failedJob.submissionState,
              submissionErrorClass: failedJob.submissionErrorClass,
              errorMessage: failedJob.errorMessage,
              userSafeError: failedJob.userSafeError,
            })
          : null,
        {
          code: "PROVIDER_ERROR",
          message: failedJob?.userSafeError?.trim() || "视频生成失败，请稍后重试。",
          retryable: true,
          action: "retry",
        },
      ),
    });
  }

  const succeeded = currentJobs.some((job) => job.status === "SUCCEEDED");
  if (succeeded || briefOwned?.status === "RENDER_SUCCEEDED" || briefOwned?.finalVideoUrl) {
    if (snapshot.finalVideo?.status === "FAILED") {
      return view({
        taskId: snapshot.taskId,
        briefId,
        status: "failed",
        stage: "video_failed",
        started: true,
        deliverableUrl: null,
        failure: {
          code: "PROVIDER_ERROR",
          message: "成片拼接未完成，还不能交付。",
          retryable: false,
          action: "contact_support",
        },
      });
    }
    return view({
      taskId: snapshot.taskId,
      briefId,
      status: "processing_output",
      stage: "output_pending",
      started: true,
      deliverableUrl: null,
      failure: null,
    });
  }

  if (currentJobs.length > 0 && currentJobs.every((job) => job.status === "CANCELLED")) {
    return view({
      taskId: snapshot.taskId,
      briefId,
      status: "cancelled",
      stage: "storyboard_cancelled",
      started: true,
      deliverableUrl: null,
      failure: null,
    });
  }

  const storyboard = snapshot.storyboard;
  if (!storyboard) {
    return view({
      taskId: snapshot.taskId,
      briefId: null,
      status: "awaiting_confirmation",
      stage: "needs_storyboard",
      started: false,
      deliverableUrl: null,
      failure: null,
    });
  }
  if (storyboard.status === "CANCELLED") {
    return view({
      taskId: snapshot.taskId,
      briefId: null,
      status: "cancelled",
      stage: "storyboard_cancelled",
      started: false,
      deliverableUrl: null,
      failure: null,
    });
  }
  if (storyboard.status === "FAILED") {
    return view({
      taskId: snapshot.taskId,
      briefId: null,
      status: "awaiting_confirmation",
      stage: "storyboard_failed",
      started: false,
      deliverableUrl: null,
      failure: {
        code: "QUALITY_BLOCKED",
        message: "故事板没有完成。请在创作台修改描述后重新确认，视频尚未开拍。",
        retryable: false,
        action: "fix_request",
      },
    });
  }
  if (storyboard.status === "APPROVED") {
    return view({
      taskId: snapshot.taskId,
      briefId: null,
      status: "awaiting_confirmation",
      stage: "storyboard_approved",
      started: false,
      deliverableUrl: null,
      failure: null,
    });
  }
  if (storyboard.status === "AWAITING_APPROVAL") {
    return view({
      taskId: snapshot.taskId,
      briefId: null,
      status: "awaiting_confirmation",
      stage: "storyboard_ready",
      started: false,
      deliverableUrl: null,
      failure: null,
    });
  }
  return view({
    taskId: snapshot.taskId,
    briefId: null,
    status: "awaiting_confirmation",
    stage: "storyboard_generating",
    started: false,
    deliverableUrl: null,
    failure: null,
  });
}
