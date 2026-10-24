import { ProviderSubmissionState, VideoJobStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { cancelActiveStoryboardRunsForUser } from "@/lib/video-generation/storyboard-service";
import { forgetAccountStatus } from "@/lib/auth";

/**
 * 账号停用（A4 5.1，取代后台「删除用户」）。
 *
 * 铁律 §4.2：业务数据只归档不物理删除。以前 DELETE 直接 adminUser.delete，
 * 会沿 onDelete: Cascade 把客户的批次、素材、工作区、用量一起删光（bughunt #1）。
 * 现在只写 disabledAt / disabledReason：
 * - 登录被拒（auth.ts authorize），已有会话在 API 守卫处立即失效、页面最多 5 分钟内失效；
 * - 同一事务里把该用户**还没提交给供应商**的排队 / 暂停视频任务改成已取消（只改状态）；
 *   已提交的任务不动——它们会照常完成并把素材收回来，花过钱的东西不能丢；
 * - 名下所有数据原样保留，恢复（enableAccount，DELETE .../disable）后一切照旧（已取消的任务除外）。
 *
 * 生成中的故事板由 storyboard-service 的取消函数负责（A2），在路由层事务之后调用。
 */

export class AccountDisableError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "self" | "invalid_reason",
  ) {
    super(message);
    this.name = "AccountDisableError";
  }
}

export const DISABLE_REASON_MAX_LENGTH = 500;

/// 停用时取消的视频任务：排队 / 暂停，且确定没有到过供应商
/// （未提交或被明确拒绝、没有外部任务号）。提交中 / 回执未知的留给对账收回素材。
export function cancellableVideoJobsWhere(args: {
  userId: string;
  includeDeliveryOrders: boolean;
}): Prisma.VideoJobWhereInput {
  const owned: Prisma.VideoJobWhereInput[] = [{ batchJob: { userId: args.userId } }];
  if (args.includeDeliveryOrders) {
    owned.push({
      videoBrief: {
        contentAngle: {
          round: { deliveryOrder: { createdById: args.userId } },
        },
      },
    });
  }
  return {
    status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.PAUSED] },
    submissionState: {
      in: [ProviderSubmissionState.NOT_STARTED, ProviderSubmissionState.REJECTED],
    },
    externalJobId: null,
    OR: owned,
  };
}

export type DisableAccountResult = {
  userId: string;
  disabledAt: Date;
  alreadyDisabled: boolean;
  cancelledVideoJobs: number;
};

export async function disableAccount(args: {
  targetUserId: string;
  actorUserId: string;
  reason: string;
  now?: Date;
}): Promise<DisableAccountResult> {
  const reason = args.reason.trim();
  if (!reason || reason.length > DISABLE_REASON_MAX_LENGTH) {
    throw new AccountDisableError(
      `请填写停用原因（1–${DISABLE_REASON_MAX_LENGTH} 字）`,
      "invalid_reason",
    );
  }
  if (args.targetUserId === args.actorUserId) {
    throw new AccountDisableError("不能停用自己", "self");
  }
  const now = args.now ?? new Date();

  const result = await db.$transaction(async (tx) => {
    const target = await tx.adminUser.findUnique({
      where: { id: args.targetUserId },
      select: { id: true, role: true, disabledAt: true },
    });
    if (!target) {
      throw new AccountDisableError("账号不存在", "not_found");
    }

    /// CAS：只有尚未停用的才写；重复停用保留第一次的时间与原因。
    const marked = await tx.adminUser.updateMany({
      where: { id: target.id, disabledAt: null },
      data: { disabledAt: now, disabledReason: reason },
    });

    /// 重复停用也再扫一遍：停用前一刻刚排进来的任务一并取消（幂等，只改状态）。
    /// 订单路径只对客户账号生效：内部员工建的代运营订单属于客户，不能因为员工停用被取消。
    const cancelled = await tx.videoJob.updateMany({
      where: cancellableVideoJobsWhere({
        userId: target.id,
        includeDeliveryOrders: target.role === "CUSTOMER",
      }),
      data: {
        status: VideoJobStatus.CANCELLED,
        finishedAt: now,
        errorMessage: "账号已停用，未开始的任务已取消",
        userSafeError: "已取消",
      },
    });

    return {
      userId: target.id,
      disabledAt: marked.count === 1 ? now : (target.disabledAt ?? now),
      alreadyDisabled: marked.count !== 1,
      cancelledVideoJobs: cancelled.count,
    };
  });

  forgetAccountStatus(result.userId);
  /// 仍在出帧的故事板（单条与批量）一起真取消：每条自带事务，所以放在停用事务提交之后；
  /// 失败只记日志——停用本身已经生效，故事板轮询也会跳过停用账号。
  await cancelActiveStoryboardRunsForUser(result.userId).catch((err) =>
    console.warn(`[account-disable] cancel storyboards for ${result.userId} failed:`, (err as Error).message),
  );
  return result;
}

/**
 * 恢复停用的账号：只清停用标记，数据本来就都在。停用时取消的任务不会自动复活，
 * 需要的话由用户在成品库 / 批次详情里重新发起。
 */
export async function enableAccount(args: {
  targetUserId: string;
}): Promise<{ userId: string; wasDisabled: boolean }> {
  const target = await db.adminUser.findUnique({
    where: { id: args.targetUserId },
    select: { id: true },
  });
  if (!target) {
    throw new AccountDisableError("账号不存在", "not_found");
  }
  const updated = await db.adminUser.updateMany({
    where: { id: target.id, disabledAt: { not: null } },
    data: { disabledAt: null, disabledReason: null },
  });
  forgetAccountStatus(target.id);
  return { userId: target.id, wasDisabled: updated.count === 1 };
}
