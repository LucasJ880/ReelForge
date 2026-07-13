import type { AdminRole } from "@prisma/client";
import { db } from "@/lib/db";

export const PLAN_STARTER = "starter" as const;
export const PLAN_STUDIO = "studio" as const;
export type WorkspacePlanId = typeof PLAN_STARTER | typeof PLAN_STUDIO;
export type PlatformFeature = "digitalHuman";

export interface PlanEntitlementSnapshot {
  planId: WorkspacePlanId;
  monthlyVideoLimit: number;
  batchConcurrencyLimit: number;
  templateLibraryAccess: "standard" | "full";
  featureFlags: Record<PlatformFeature, boolean>;
}

export const PLAN_ENTITLEMENT_DEFAULTS: Record<
  WorkspacePlanId,
  PlanEntitlementSnapshot
> = {
  starter: {
    planId: PLAN_STARTER,
    monthlyVideoLimit: 30,
    batchConcurrencyLimit: 10,
    templateLibraryAccess: "standard",
    featureFlags: { digitalHuman: false },
  },
  studio: {
    planId: PLAN_STUDIO,
    monthlyVideoLimit: 200,
    batchConcurrencyLimit: 10,
    templateLibraryAccess: "full",
    featureFlags: { digitalHuman: false },
  },
};

export function planForLegacyUserType(
  userType: string | null | undefined,
): WorkspacePlanId {
  return userType === "BUSINESS" ? PLAN_STUDIO : PLAN_STARTER;
}

export function isSystemRole(role: AdminRole | string): boolean {
  return role === "OPERATOR" || role === "SUPER_ADMIN";
}

export function isFeatureEnabledForPlan(
  planId: WorkspacePlanId,
  feature: PlatformFeature,
): boolean {
  return PLAN_ENTITLEMENT_DEFAULTS[planId].featureFlags[feature] === true;
}

export async function getWorkspacePlanForUser(
  userId: string,
): Promise<PlanEntitlementSnapshot> {
  const workspace = await db.workspace.findUnique({
    where: { ownerId: userId },
    include: { plan: true },
  });
  if (!workspace) {
    throw new Error("用户缺少默认 Workspace；请先执行 Phase 1 workspace migration");
  }
  const planId = workspace.planId as WorkspacePlanId;
  return {
    planId,
    monthlyVideoLimit: workspace.plan.monthlyVideoLimit,
    batchConcurrencyLimit: workspace.plan.batchConcurrencyLimit,
    templateLibraryAccess:
      workspace.plan.templateLibraryAccess === "full" ? "full" : "standard",
    featureFlags: {
      // Digital human is sealed for every plan in Phase 1.
      digitalHuman: false,
    },
  };
}
