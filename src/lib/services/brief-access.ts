import type { Session } from "next-auth";
import { db } from "@/lib/db";

/**
 * Phase 6 — Brief 级访问控制。
 *
 * 用于客户用户（PERSONAL / BUSINESS）调用 brief 范围的端点
 * （如 render-status / render-retry），仅当：
 *   - 调用方是该 brief 所属 DeliveryOrder 的 createdBy（即"自己的视频"），或
 *   - 调用方是内部 staff（OPERATOR / SUPER_ADMIN userType）
 *
 * 设计权衡：
 *   - 不在 db 层做 multi-tenant 自动过滤（项目还没引入 RLS / per-tenant prisma client），
 *     所有 helper 都返回布尔值，由路由层显式 fail-fast。
 *   - 兼容老数据：DeliveryOrder.createdById 历史上必然有值，所以不存在 null owner 的情况。
 *
 * 后续 Phase 7+ 可能会把"团队 / 协作者"加进来；那时把这里的 caller eligibility
 * 模型改成 set-based 即可。
 */

export type BriefAccessReason =
  | "owner"
  | "internal-staff"
  | "not-found"
  | "forbidden";

export interface BriefAccessResult {
  allowed: boolean;
  reason: BriefAccessReason;
  briefId: string;
  ownerUserId: string | null;
  /// 若访问被允许，给路由层一个"导航回该用户视图"的提示
  ownerPersona: "BUSINESS" | "PERSONAL" | null;
}

/**
 * Pure 决策：纯 args → 结果。db 查询交给 caller，便于单测无 IO。
 */
export function decideBriefAccess(args: {
  callerUserId: string | null | undefined;
  callerRole: "CUSTOMER" | "REVIEWER" | "OPERATOR" | "SUPER_ADMIN" | null | undefined;
  ownerUserId: string | null | undefined;
  ownerPersona: "BUSINESS" | "PERSONAL" | null | undefined;
  briefId: string;
}): BriefAccessResult {
  const isInternalStaff =
    args.callerRole === "OPERATOR" ||
    args.callerRole === "SUPER_ADMIN";

  if (isInternalStaff) {
    return {
      allowed: true,
      reason: "internal-staff",
      briefId: args.briefId,
      ownerUserId: args.ownerUserId ?? null,
      ownerPersona: args.ownerPersona ?? null,
    };
  }

  if (!args.ownerUserId) {
    return {
      allowed: false,
      reason: "not-found",
      briefId: args.briefId,
      ownerUserId: null,
      ownerPersona: args.ownerPersona ?? null,
    };
  }

  if (
    args.callerUserId &&
    args.callerUserId === args.ownerUserId
  ) {
    return {
      allowed: true,
      reason: "owner",
      briefId: args.briefId,
      ownerUserId: args.ownerUserId,
      ownerPersona: args.ownerPersona ?? null,
    };
  }

  return {
    allowed: false,
    reason: "forbidden",
    briefId: args.briefId,
    ownerUserId: args.ownerUserId,
    ownerPersona: args.ownerPersona ?? null,
  };
}

/**
 * IO 版：从 db 取 brief 的 owner，再交给 decideBriefAccess。
 * 没有 brief / 路径异常 → allowed=false reason="not-found"。
 */
export async function checkBriefAccess(
  briefId: string,
  session: Session,
): Promise<BriefAccessResult> {
  const brief = await db.videoBrief
    .findUnique({
      where: { id: briefId },
      select: {
        id: true,
        persona: true,
        contentAngle: {
          select: {
            round: {
              select: {
                deliveryOrder: {
                  select: { createdById: true },
                },
              },
            },
          },
        },
      },
    })
    .catch(() => null);

  if (!brief) {
    return decideBriefAccess({
      callerUserId: session.user.id,
      callerRole: session.user.role,
      ownerUserId: null,
      ownerPersona: null,
      briefId,
    });
  }

  const ownerPersonaRaw = brief.persona ?? null;
  const ownerPersona =
    ownerPersonaRaw === "BUSINESS" || ownerPersonaRaw === "PERSONAL"
      ? ownerPersonaRaw
      : null;

  return decideBriefAccess({
    callerUserId: session.user.id,
    callerRole: session.user.role,
    ownerUserId: brief.contentAngle?.round?.deliveryOrder?.createdById ?? null,
    ownerPersona,
    briefId,
  });
}
