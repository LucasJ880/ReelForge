import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";
import {
  BUSINESS_INDUSTRIES,
  FALLBACK_TEMPLATE_ORDER,
  INDUSTRY_TEMPLATE_PREFERENCES,
  type BusinessIndustry,
} from "@/lib/onboarding/industries";
import { listActiveStyleTemplates } from "@/lib/services/style-template-service";
import { listWorkspaceBrandPackagesForUser } from "@/lib/services/workspace-brand-package-service";
import { loadRecentVideoRows } from "@/lib/services/unified-library-service";
import { loadVideoQuota } from "@/lib/services/exchange-readings";
import { parseLeadPageConfig } from "@/lib/services/lead-service";
import { emailConfig, founderEmail, safeSubject, sendEmail } from "@/lib/services/notification-service";
import { hasVerifiedTemplateVideo, verifiedTemplateSample, verifiedTemplateVideo } from "@/lib/video-generation/template-sample";

/**
 * 自助注册后的上手向导（1025 整合轮 C1）：/app/welcome 四步——生意 → 品牌 → 第一条视频 → 询盘页。
 *
 * 每一步的「做没做完」都从真实数据推出来（档案、品牌包、成片、询盘页状态），不另存一张勾选表：
 * 在别处做完（品牌页、创作页）向导里也算完；向导只记「走完 / 跳过」的时间，决定 /app 先进哪一页。
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const businessProfileSchema = z.object({
  industry: z.enum(BUSINESS_INDUSTRIES).nullish().transform((value) => value ?? null),
  city: optionalText(80),
  website: optionalText(160),
  oneLiner: optionalText(200),
});

export type BusinessProfile = z.infer<typeof businessProfileSchema>;

export const businessProfileInputSchema = businessProfileSchema.extend({
  businessName: z.string().trim().min(1).max(80),
});

export type BusinessProfileInput = z.infer<typeof businessProfileInputSchema>;

const EMPTY_PROFILE: BusinessProfile = { industry: null, city: null, website: null, oneLiner: null };

export function parseBusinessProfile(raw: Prisma.JsonValue | null | undefined): BusinessProfile {
  const parsed = businessProfileSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_PROFILE;
}

function profileToJson(profile: BusinessProfile): Prisma.InputJsonValue {
  return Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== null)) as Prisma.InputJsonValue;
}

export type StepStatus = "todo" | "started" | "done";

export type OnboardingTemplate = {
  slug: string;
  name: string;
  video: string;
  poster: string | null;
};

export type OnboardingState = {
  businessName: string;
  profile: BusinessProfile;
  completedAt: string | null;
  steps: {
    business: StepStatus;
    brand: StepStatus;
    video: StepStatus;
    leadPage: StepStatus;
  };
  brandPackageName: string | null;
  leadPage: {
    enabled: boolean;
    publicSlug: string | null;
    requestedAt: string | null;
    businessName: string | null;
    headline: string | null;
    intro: string | null;
    services: string[];
    phone: string | null;
    region: string | null;
  };
  quota: { used: number; limit: number };
  templates: OnboardingTemplate[];
};

class OnboardingWorkspaceMissingError extends Error {
  constructor() {
    super("workspace not found");
    this.name = "OnboardingWorkspaceMissingError";
  }
}

export function isOnboardingWorkspaceMissing(error: unknown): boolean {
  return error instanceof OnboardingWorkspaceMissingError;
}

async function requireWorkspace(userId: string) {
  const workspace = await db.workspace.findUnique({
    where: { ownerId: userId },
    select: {
      id: true,
      name: true,
      businessProfile: true,
      onboardingCompletedAt: true,
      leadPageEnabled: true,
      leadPageConfig: true,
      leadPageRequestedAt: true,
      publicSlug: true,
    },
  });
  if (!workspace) throw new OnboardingWorkspaceMissingError();
  return workspace;
}

/**
 * 第 3 步的推荐模板：按行业偏好、再按通用顺序，取前 3 个有真机样片的（样片即门面，没验收的不推）。
 * 模板名从模板库取；模板库取不到就不推荐（向导照常可走，直接去创作页）。
 */
export async function recommendedTemplates(
  industry: BusinessIndustry | null,
  locale: Locale,
): Promise<OnboardingTemplate[]> {
  let templates: Awaited<ReturnType<typeof listActiveStyleTemplates>> = [];
  try {
    templates = await listActiveStyleTemplates();
  } catch {
    return [];
  }
  const bySlug = new Map(templates.map((template) => [template.slug, template]));
  const order = [...(industry ? INDUSTRY_TEMPLATE_PREFERENCES[industry] : []), ...FALLBACK_TEMPLATE_ORDER];
  const picked: OnboardingTemplate[] = [];
  for (const slug of order) {
    if (picked.length >= 3) break;
    if (picked.some((item) => item.slug === slug)) continue;
    const template = bySlug.get(slug);
    if (!template || !hasVerifiedTemplateVideo(slug)) continue;
    const video = verifiedTemplateVideo(slug, `/template-previews/${slug}.mp4`);
    if (!video) continue;
    picked.push({
      slug,
      name: locale === "en-US" ? template.name : template.nameZh,
      video,
      poster: verifiedTemplateSample(slug, template.coverImage),
    });
  }
  return picked;
}

export async function loadOnboardingState(userId: string, locale: Locale): Promise<OnboardingState> {
  const workspace = await requireWorkspace(userId);
  const profile = parseBusinessProfile(workspace.businessProfile);
  const leadConfig = parseLeadPageConfig(workspace.leadPageConfig);
  const [packages, recentVideos, quota, templates] = await Promise.all([
    listWorkspaceBrandPackagesForUser(userId),
    loadRecentVideoRows(userId, { take: 5, locale }),
    loadVideoQuota(userId),
    recommendedTemplates(profile.industry, locale),
  ]);
  const ownPackages = packages.filter((item) => item.scope === "workspace");
  const videoStatus: StepStatus = recentVideos.some((row) => row.status === "ready")
    ? "done"
    : recentVideos.length > 0
      ? "started"
      : "todo";
  const leadPageStatus: StepStatus = workspace.leadPageEnabled || workspace.leadPageRequestedAt
    ? "done"
    : leadConfig.businessName || leadConfig.headline
      ? "started"
      : "todo";
  return {
    businessName: workspace.name,
    profile,
    completedAt: workspace.onboardingCompletedAt?.toISOString() ?? null,
    steps: {
      business: profile.industry ? "done" : "todo",
      brand: ownPackages.length > 0 ? "done" : "todo",
      video: videoStatus,
      leadPage: leadPageStatus,
    },
    brandPackageName: ownPackages.find((item) => item.isDefault)?.name ?? ownPackages[0]?.name ?? null,
    leadPage: {
      enabled: workspace.leadPageEnabled,
      publicSlug: workspace.leadPageEnabled ? workspace.publicSlug : null,
      requestedAt: workspace.leadPageRequestedAt?.toISOString() ?? null,
      businessName: leadConfig.businessName ?? null,
      headline: leadConfig.headline ?? null,
      intro: leadConfig.intro ?? null,
      services: leadConfig.services ?? [],
      phone: leadConfig.phone ?? null,
      region: leadConfig.region ?? null,
    },
    quota: { used: quota.used, limit: quota.limit },
    templates,
  };
}

/** 第 1 步：店名进工作区名，其余进生意档案。 */
export async function updateBusinessProfile(userId: string, input: BusinessProfileInput): Promise<BusinessProfile> {
  const workspace = await requireWorkspace(userId);
  const profile: BusinessProfile = {
    industry: input.industry,
    city: input.city,
    website: input.website,
    oneLiner: input.oneLiner,
  };
  await db.workspace.update({
    where: { id: workspace.id },
    data: { name: input.businessName, businessProfile: profileToJson(profile) },
  });
  return profile;
}

/** 走完或跳过：只写一次（重复调用保留第一次的时间）。 */
export async function completeOnboarding(userId: string, now: Date = new Date()): Promise<string> {
  const workspace = await requireWorkspace(userId);
  if (workspace.onboardingCompletedAt) return workspace.onboardingCompletedAt.toISOString();
  await db.workspace.updateMany({
    where: { id: workspace.id, onboardingCompletedAt: null },
    data: { onboardingCompletedAt: now },
  });
  return now.toISOString();
}

/**
 * /app 的去处：自助注册的客户在向导走完（或跳过）之前先进 /app/welcome。
 * 工作区不存在时不拦（壳层自己会报错），也不因查库失败把人挡在门外。
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  try {
    const workspace = await db.workspace.findUnique({
      where: { ownerId: userId },
      select: { onboardingCompletedAt: true },
    });
    return Boolean(workspace) && !workspace?.onboardingCompletedAt;
  } catch {
    return false;
  }
}

export type ActivationRequestResult = { requestedAt: string; alreadyRequested: boolean; alreadyEnabled: boolean };

/**
 * 第 4 步「申请开通询盘页」：记下时间并提醒创始人（开通与地址仍归超管）。
 * 条件更新保证只提醒一次：重复点返回第一次的时间，不再发信。
 */
export async function requestLeadPageActivation(userId: string, now: Date = new Date()): Promise<ActivationRequestResult> {
  const workspace = await requireWorkspace(userId);
  if (workspace.leadPageEnabled) {
    return {
      requestedAt: (workspace.leadPageRequestedAt ?? now).toISOString(),
      alreadyRequested: Boolean(workspace.leadPageRequestedAt),
      alreadyEnabled: true,
    };
  }
  if (workspace.leadPageRequestedAt) {
    return { requestedAt: workspace.leadPageRequestedAt.toISOString(), alreadyRequested: true, alreadyEnabled: false };
  }
  const updated = await db.workspace.updateMany({
    where: { id: workspace.id, leadPageRequestedAt: null },
    data: { leadPageRequestedAt: now },
  });
  if (updated.count === 0) {
    const current = await requireWorkspace(userId);
    return {
      requestedAt: (current.leadPageRequestedAt ?? now).toISOString(),
      alreadyRequested: true,
      alreadyEnabled: current.leadPageEnabled,
    };
  }
  return { requestedAt: now.toISOString(), alreadyRequested: false, alreadyEnabled: false };
}

/** 询盘页开通申请 → 创始人。没配 Resend 只记日志；任何失败都不抛（在响应之后跑）。 */
export async function notifyLeadPageActivationRequest(
  userId: string,
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<"sent" | "not_configured" | "no_recipient" | "send_failed"> {
  const env = deps.env ?? process.env;
  try {
    const config = emailConfig(env);
    if (!config) {
      console.info("[notify] 未配置 RESEND_API_KEY / EMAIL_FROM，跳过询盘页开通申请邮件", { userId });
      return "not_configured";
    }
    const founder = founderEmail(env);
    if (!founder) return "no_recipient";
    const [user, workspace] = await Promise.all([
      db.adminUser.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
      requireWorkspace(userId),
    ]);
    const profile = parseBusinessProfile(workspace.businessProfile);
    const text = [
      "询盘页开通申请 / Inquiry page activation request",
      "",
      `店名 / Business: ${workspace.name}`,
      `账号 / Account: ${user?.email ?? "—"}`,
      profile.industry ? `行业 / Industry: ${profile.industry}` : "",
      profile.city ? `城市 / City: ${profile.city}` : "",
      profile.website ? `网站 / Website: ${profile.website}` : "",
      "",
      "在管理员询盘面板里给这个工作区分配地址并开通。",
    ]
      .filter((line, index, all) => line !== "" || all[index - 1] !== "")
      .join("\n");
    const ok = await sendEmail(
      { to: [founder], subject: safeSubject(`询盘页开通申请 Activation request: ${workspace.name}`), text },
      config,
      deps.fetchImpl,
    );
    return ok ? "sent" : "send_failed";
  } catch (error) {
    console.warn("[notify] lead page activation email failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "send_failed";
  }
}
