import { Prisma, VideoProvider } from "@prisma/client";
import { FRAME_QA_ERROR_PREFIX, runFrameTextQa } from "@/lib/video-generation/frame-qa";

/**
 * 发片前帧质检门禁的唯一入口。reconcileVideoJob 只按这里给的决定执行状态迁移，
 * 不再自己判断质检结果——门禁的策略（谁能跑、跑什么、拦不拦、结果怎么落库）都在这里。
 *
 * - pass：可以转 SUCCEEDED；successData 并入 SUCCEEDED 的写入（例如质检结果列）
 * - block：转 FAILED；failureData 是 FAILED 写入的错误字段
 * - defer：本次调用的上下文不跑质检、也不转终态，留给有质检预算的调用方
 */
export type FrameQaGateDecision =
  | { action: "pass"; successData: Prisma.VideoJobUpdateManyMutationInput }
  | {
      action: "block";
      summary: string;
      failureData: Prisma.VideoJobUpdateManyMutationInput;
    }
  | { action: "defer"; reason: string };

export async function decideFrameQaGate(params: {
  jobId: string;
  provider: VideoProvider;
  videoUrl: string | null | undefined;
}): Promise<FrameQaGateDecision> {
  if (!params.videoUrl || params.provider === VideoProvider.MOCK) {
    return { action: "pass", successData: {} };
  }
  const qa = await runFrameTextQa(params.videoUrl);
  if (!qa.ok) {
    return {
      action: "block",
      summary: qa.summary,
      failureData: {
        errorMessage: `${FRAME_QA_ERROR_PREFIX} ${qa.summary}`,
        userSafeError:
          "画面质检未通过（检测到异常文字），已自动拦截。点击「重试」可重新生成本段。",
      },
    };
  }
  if (!qa.checked) {
    console.warn(`[frame-qa] job ${params.jobId} 门禁跳过: ${qa.skipReason}`);
  }
  return { action: "pass", successData: {} };
}
