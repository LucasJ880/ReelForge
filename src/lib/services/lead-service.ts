import { Prisma, type LeadStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { LOCALES, type Locale } from "@/i18n/config";
import {
  LEAD_CONSENT_VERSION,
  LEAD_STATUSES,
  MONTHLY_LEAD_SPEND,
  PILOT_CONSENT_VERSION,
  leadConsentText,
  pilotConsentText,
} from "@/i18n/growth-copy";
import {
  RateLimitExceededError,
  bumpRateLimit,
  countRateLimitHit,
  hourlyWindowKey,
} from "@/lib/services/rate-limit-service";
import {
  TRACKED_LINK_CODE_RE,
  allowedHostsFromConfig,
  normalizeAllowedHost,
} from "@/lib/services/tracked-link-service";

/**
 * 获客闭环（1025 · A5）：商家询盘 Lead 与公开首页的试点申请 PilotApplication。
 *
 * 不变量：
 *  - 询盘页只对超管开通、且 owner 账号未停用的工作区生效（leadPageEnabled + publicSlug），slug 有保留词表。
 *  - 同一联系方式 7 天内重复提交 → 更新原询盘，不新建（读数不被刷高）；匿名的公开提交只补空字段，不改写已有内容。
 *  - 业务数据只归档（archivedAt），不物理删除；状态流转只补时间戳、不清旧时间戳。
 *  - 公开提交按访客网段哈希限流；限流 / 校验失败给人话与备用联系方式（路由层负责拼）。
 */

export const LEAD_DEDUPE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/// 公开提交限流。按访客网段（IPv4 /24、IPv6 /48，路由层聚合后哈希）每小时 5 次，超了 429——这道闸要紧。
/// 页级 / 全局只做两件事：过了「繁忙线」照收但打标记、不再发邮件（几个地址刷爆共享桶也锁不住真客户，
/// 也耗不光发信额度）；过了远高于正常流量的「安全阀」才拒收。
export const PUBLIC_LEAD_VISITOR_HOURLY_MAX = 5;
export const PUBLIC_LEAD_PAGE_HOURLY_NOTIFY_MAX = 60;
export const PUBLIC_LEAD_PAGE_HOURLY_HARD_MAX = 600;
export const PUBLIC_PILOT_VISITOR_HOURLY_MAX = 5;
export const PUBLIC_PILOT_GLOBAL_HOURLY_NOTIFY_MAX = 200;
export const PUBLIC_PILOT_GLOBAL_HOURLY_HARD_MAX = 2000;

/// 与 middleware 的 /l/<slug> 段一致（[a-z0-9-]{2,64}），且不以连字符开头 / 结尾、不含连续连字符。
export const LEAD_SLUG_RE = /^(?!.*--)[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/// 保留词：与站内路由、品牌、常见运营词冲突的地址不给商家用。
export const RESERVED_LEAD_SLUGS: ReadonlySet<string> = new Set([
  "aivora", "app", "api", "admin", "administrator", "root", "system", "internal", "ops", "staff",
  "login", "logout", "signin", "signout", "signup", "register", "auth", "account", "accounts", "settings",
  "dashboard", "wall", "l", "t", "lead", "leads", "pilot", "pilots", "apply", "demo", "showcase",
  "persona", "business", "personal", "privacy", "terms", "legal", "help", "support", "contact", "about",
  "pricing", "price", "billing", "pay", "payment", "checkout", "stripe", "blog", "docs", "status",
  "www", "mail", "email", "static", "assets", "public", "cdn", "media", "images", "test", "testing",
  "null", "undefined", "new", "edit", "official", "security", "abuse", "noreply", "no-reply",
]);

export type LeadSlugProblem = "invalid" | "reserved";

export function checkLeadSlug(slug: string): LeadSlugProblem | null {
  if (!LEAD_SLUG_RE.test(slug)) return "invalid";
  if (RESERVED_LEAD_SLUGS.has(slug)) return "reserved";
  return null;
}

// ─────────────────────────────────────────────────────────────
// 询盘页配置（Workspace.leadPageConfig）
// ─────────────────────────────────────────────────────────────

/// 逐字段 .catch(undefined)：库里某个字段坏了只丢那一项，整页照常渲染。
const optionalConfigText = (max: number) =>
  z.string().trim().max(max).optional().catch(undefined);

const leadPageConfigSchema = z.object({
  businessName: optionalConfigText(80),
  headline: optionalConfigText(120),
  intro: optionalConfigText(600),
  services: z.array(z.string().trim().min(1).max(60)).max(12).optional().catch(undefined),
  phone: optionalConfigText(32),
  region: optionalConfigText(80),
  locale: z.enum(LOCALES).optional().catch(undefined),
});

export type LeadPageConfig = z.infer<typeof leadPageConfigSchema> & { allowedHosts: string[] };

export function parseLeadPageConfig(raw: Prisma.JsonValue | null | undefined): LeadPageConfig {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const parsed = leadPageConfigSchema.safeParse(source);
  const base = parsed.success ? parsed.data : {};
  return {
    ...Object.fromEntries(Object.entries(base).filter(([, value]) => value !== undefined && value !== "")),
    allowedHosts: allowedHostsFromConfig(raw ?? null),
  } as LeadPageConfig;
}

/** 工作区默认名（"My Workspace" / "xx Workspace"）不能拿出去当店名。 */
export function displayBusinessName(config: LeadPageConfig, workspaceName: string): string | null {
  if (config.businessName) return config.businessName;
  const stripped = workspaceName.replace(/\s*workspace\s*$/i, "").trim();
  if (!stripped || /^my$/i.test(stripped)) return null;
  return stripped;
}

export type PublicLeadPage = {
  workspaceId: string;
  slug: string;
  businessName: string | null;
  config: LeadPageConfig;
};

/// 公开面查工作区时一并取 owner 的停用状态：账号停用 = 询盘页、追踪链接、公开提交一起下线。
/// 不去改 leadPageEnabled，恢复账号（enableAccount）后自动重新开放。
const PUBLIC_WORKSPACE_SELECT = {
  id: true,
  name: true,
  leadPageEnabled: true,
  leadPageConfig: true,
  owner: { select: { disabledAt: true } },
} satisfies Prisma.WorkspaceSelect;

/** 公开询盘页：格式不对、保留词、未开通、owner 账号已停用，一律当不存在（404）。 */
export async function getPublicLeadPage(slug: string): Promise<PublicLeadPage | null> {
  if (checkLeadSlug(slug)) return null;
  const workspace = await db.workspace.findUnique({
    where: { publicSlug: slug },
    select: PUBLIC_WORKSPACE_SELECT,
  });
  if (!workspace?.leadPageEnabled || workspace.owner.disabledAt) return null;
  const config = parseLeadPageConfig(workspace.leadPageConfig);
  return {
    workspaceId: workspace.id,
    slug,
    businessName: displayBusinessName(config, workspace.name),
    config,
  };
}

// ─────────────────────────────────────────────────────────────
// 规范化与去重
// ─────────────────────────────────────────────────────────────

/// 允许「(416) 555-0100」「+1 416.555.0100」「138 1234 5678」这类常见写法；位数另算（7–15 位）。
const PHONE_CHARS_RE = /^\+?[0-9 ().-]{6,30}$/;

export function isPlausiblePhone(raw: string): boolean {
  const value = raw.trim();
  if (!PHONE_CHARS_RE.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

/**
 * 去重用的电话：只留数字，取末 10 位。北美「+1 416…」与「416…」、
 * 中国「+86 138…」与「138…」都会落到同一个键；不足 10 位就用全部数字。
 */
export function normalizePhoneForDedupe(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return value || null;
}

export function buildLeadDedupeKey(phone: string | null | undefined, email: string | null | undefined): string | null {
  const normalizedPhone = normalizePhoneForDedupe(phone);
  if (normalizedPhone) return `p:${normalizedPhone}`;
  const normalizedEmail = normalizeEmail(email);
  return normalizedEmail ? `e:${normalizedEmail}` : null;
}

// ─────────────────────────────────────────────────────────────
// 输入校验（公开端点与工作台共用的片段）
// ─────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .nullish()
  .transform((value) => (value ? value.toLowerCase() : null))
  .refine((value) => value === null || z.string().email().safeParse(value).success, { message: "email_invalid" });

const optionalPhone = (message: string) =>
  z
    .string()
    .trim()
    .max(32)
    .nullish()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || isPlausiblePhone(value), { message });

export const publicLeadInputSchema = z.object({
  slug: z.string().regex(LEAD_SLUG_RE),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(32).refine(isPlausiblePhone, { message: "phone_invalid" }),
  email: optionalEmail,
  serviceInterest: optionalText(120),
  preferredTime: optionalText(80),
  selfReportedSource: optionalText(60),
  message: optionalText(1000),
  consent: z.literal(true, { errorMap: () => ({ message: "consent_required" }) }),
  consentVersion: z.literal(LEAD_CONSENT_VERSION),
  trackedCode: z
    .string()
    .nullish()
    .transform((value) => (value && TRACKED_LINK_CODE_RE.test(value) ? value : null)),
  utmSource: optionalText(100),
  utmMedium: optionalText(100),
  utmCampaign: optionalText(100),
  locale: z.enum(LOCALES).nullish(),
});

export type PublicLeadInput = z.infer<typeof publicLeadInputSchema>;

export const manualLeadInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    phone: optionalPhone("phone_invalid"),
    email: optionalEmail,
    serviceInterest: optionalText(120),
    preferredTime: optionalText(80),
    selfReportedSource: optionalText(60),
    message: optionalText(1000),
  })
  .refine((value) => Boolean(value.phone || value.email), { message: "contact_required", path: ["phone"] });

export type ManualLeadInput = z.infer<typeof manualLeadInputSchema>;

export const pilotApplicationInputSchema = z
  .object({
    name: optionalText(80),
    company: optionalText(120),
    email: optionalEmail,
    phone: optionalPhone("phone_invalid"),
    whatsapp: optionalPhone("whatsapp_invalid"),
    wechat: z
      .string()
      .trim()
      .max(40)
      .nullish()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || /^[A-Za-z0-9_+-]{3,40}$/.test(value), { message: "wechat_invalid" }),
    website: optionalText(200),
    industry: optionalText(80),
    city: optionalText(80),
    monthlyLeadSpend: z.enum(MONTHLY_LEAD_SPEND).nullish().transform((value) => value ?? null),
    message: optionalText(1000),
    locale: z.enum(LOCALES).nullish(),
    consent: z.literal(true, { errorMap: () => ({ message: "consent_required" }) }),
    consentVersion: z.literal(PILOT_CONSENT_VERSION),
  })
  .refine((value) => Boolean(value.email || value.phone || value.whatsapp || value.wechat), {
    message: "contact_required",
    path: ["contact"],
  });

export type PilotApplicationInput = z.infer<typeof pilotApplicationInputSchema>;

/** zod 问题 → 公开端点可本地化的错误 key（客户端按 key 取文案）。 */
export function publicValidationReason(error: z.ZodError): "contact_required" | "consent_required" | "phone_invalid" | "invalid" {
  const messages = new Set(error.issues.map((issue) => issue.message));
  if (messages.has("contact_required")) return "contact_required";
  if (messages.has("consent_required") || error.issues.some((issue) => issue.path[0] === "consentVersion")) {
    return "consent_required";
  }
  if (messages.has("phone_invalid")) return "phone_invalid";
  return "invalid";
}

// ─────────────────────────────────────────────────────────────
// 公开提交：询盘
// ─────────────────────────────────────────────────────────────

export class LeadPageNotFoundError extends Error {
  readonly code = "LEAD_PAGE_NOT_FOUND" as const;
  constructor() {
    super("询盘页不存在或未开通");
    this.name = "LeadPageNotFoundError";
  }
}

/** 限流时带上商家电话，让访客有别的路可走（D4：人话报错与备用联系方式）。 */
export class LeadRateLimitedError extends RateLimitExceededError {
  constructor(readonly fallbackPhone: string | null) {
    super("提交太频繁了，请稍后再试");
    this.name = "LeadRateLimitedError";
  }
}

type LeadFields = {
  name: string;
  phone: string | null;
  email: string | null;
  serviceInterest: string | null;
  preferredTime: string | null;
  selfReportedSource: string | null;
  message: string | null;
};

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

const LEAD_OPTIONAL_FIELDS = ["phone", "email", "serviceInterest", "preferredTime", "selfReportedSource", "message"] as const;

/**
 * 7 天内同一去重键的未归档询盘：有就更新它，没有就新建；来源归因保留首次触达。
 * 返回 deduped 让调用方决定是否再通知。
 *
 * 更新怎么写取决于谁在写（mode）：
 *  - manual：商家本人在工作台录入，最新一次的非空字段覆盖旧值；
 *  - public：匿名访客只凭一个电话 / 邮箱就能撞上已有询盘（包括商家手录的、已预约 / 已成交的），
 *    所以只补原来为空的字段，姓名、电话、邮箱、留言等已有内容一律不改；
 *    这次提交原样记进 meta.lastSubmission，商家仍看得到对方又来过、这次说了什么。
 */
async function upsertLeadWithinWindow(args: {
  workspaceId: string;
  fields: LeadFields;
  dedupeKey: string | null;
  now: Date;
  mode: "public" | "manual";
  create: Omit<Prisma.LeadUncheckedCreateInput, keyof LeadFields | "workspaceId" | "dedupeKey">;
  touch: Record<string, Prisma.JsonValue>;
}): Promise<{ leadId: string; deduped: boolean; needsNotify: boolean }> {
  const existing = args.dedupeKey
    ? await db.lead.findFirst({
        where: {
          workspaceId: args.workspaceId,
          dedupeKey: args.dedupeKey,
          archivedAt: null,
          createdAt: { gte: new Date(args.now.getTime() - LEAD_DEDUPE_WINDOW_DAYS * DAY_MS) },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          meta: true,
          notifiedAt: true,
          name: true,
          phone: true,
          email: true,
          serviceInterest: true,
          preferredTime: true,
          selfReportedSource: true,
          message: true,
        },
      })
    : null;

  if (existing) {
    const meta = jsonObject(existing.meta);
    const submissions = typeof meta.submissions === "number" ? meta.submissions : 1;
    const nextMeta: Record<string, Prisma.JsonValue> = {
      ...meta,
      ...args.touch,
      submissions: submissions + 1,
      lastSubmittedAt: args.now.toISOString(),
    };
    const patch: Prisma.LeadUpdateInput = {};
    if (args.mode === "manual") {
      patch.name = args.fields.name;
      for (const key of LEAD_OPTIONAL_FIELDS) {
        if (args.fields[key]) patch[key] = args.fields[key];
      }
    } else {
      /// 姓名必填、库里永远有值，所以公开提交从不改姓名
      for (const key of LEAD_OPTIONAL_FIELDS) {
        if (args.fields[key] && !existing[key]) patch[key] = args.fields[key];
      }
      nextMeta.lastSubmission = { ...args.fields, at: args.now.toISOString() };
    }
    patch.meta = nextMeta;
    await db.lead.update({ where: { id: existing.id }, data: patch });
    return { leadId: existing.id, deduped: true, needsNotify: existing.notifiedAt === null };
  }

  const lead = await db.lead.create({
    data: {
      ...args.create,
      ...args.fields,
      workspaceId: args.workspaceId,
      dedupeKey: args.dedupeKey,
      meta: { ...jsonObject(args.create.meta as Prisma.JsonValue), ...args.touch, submissions: 1 },
    },
    select: { id: true },
  });
  return { leadId: lead.id, deduped: false, needsNotify: true };
}

export async function submitPublicLead(
  input: PublicLeadInput,
  context: { visitorHash: string; now?: Date },
): Promise<{ leadId: string; deduped: boolean; needsNotify: boolean }> {
  const now = context.now ?? new Date();
  const workspace = await db.workspace.findUnique({
    where: { publicSlug: input.slug },
    select: PUBLIC_WORKSPACE_SELECT,
  });
  if (!workspace?.leadPageEnabled || workspace.owner.disabledAt || checkLeadSlug(input.slug)) {
    throw new LeadPageNotFoundError();
  }
  const config = parseLeadPageConfig(workspace.leadPageConfig);

  const window = hourlyWindowKey(now);
  try {
    await bumpRateLimit(`public-lead:${workspace.id}:${context.visitorHash}`, window, PUBLIC_LEAD_VISITOR_HOURLY_MAX);
  } catch (error) {
    if (error instanceof RateLimitExceededError) throw new LeadRateLimitedError(config.phone ?? null);
    throw error;
  }
  /// 页级桶只在访客闸放行后才计数，所以每个网段每小时最多给它添 5 次
  const pageHits = await countRateLimitHit(`public-lead-page:${workspace.id}`, window);
  if (pageHits > PUBLIC_LEAD_PAGE_HOURLY_HARD_MAX) throw new LeadRateLimitedError(config.phone ?? null);
  /// 过了繁忙线：照收（同一小时里的真客户不吃 429），但新询盘打标记待复核、这一单不发邮件
  const busy = pageHits > PUBLIC_LEAD_PAGE_HOURLY_NOTIFY_MAX;

  /// 归因只认本工作区、未停用的追踪链接；别家的码或停用的码按询盘页直达算。
  const trackedLink = input.trackedCode
    ? await db.trackedLink.findFirst({
        where: { code: input.trackedCode, workspaceId: workspace.id, archivedAt: null },
        select: { id: true },
      })
    : null;

  const locale: Locale = input.locale ?? config.locale ?? "zh-CN";
  const business = displayBusinessName(config, workspace.name) ?? workspace.name;
  const result = await upsertLeadWithinWindow({
    workspaceId: workspace.id,
    dedupeKey: buildLeadDedupeKey(input.phone, input.email),
    now,
    mode: "public",
    fields: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      serviceInterest: input.serviceInterest,
      preferredTime: input.preferredTime,
      selfReportedSource: input.selfReportedSource,
      message: input.message,
    },
    create: {
      source: trackedLink ? "tracked_link" : "lead_page",
      trackedLinkId: trackedLink?.id ?? null,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      consentAt: now,
      consentVersion: input.consentVersion,
      meta: {
        locale,
        consentText: leadConsentText(locale, business),
        ...(busy ? { flagged: "page_burst" } : {}),
      },
    },
    touch: {
      lastTrackedLinkId: trackedLink?.id ?? null,
      lastConsentAt: now.toISOString(),
    },
  });
  return busy ? { ...result, needsNotify: false } : result;
}

// ─────────────────────────────────────────────────────────────
// 工作台：手工录入、状态流转、归档、核实
// ─────────────────────────────────────────────────────────────

export class LeadNotFoundError extends Error {
  readonly code = "LEAD_NOT_FOUND" as const;
  constructor() {
    super("询盘不存在或已归档");
    this.name = "LeadNotFoundError";
  }
}

export class LeadConflictError extends Error {
  readonly code = "LEAD_CONFLICT" as const;
  constructor() {
    super("询盘刚被改过，请刷新后再试");
    this.name = "LeadConflictError";
  }
}

export async function createManualLead(
  workspaceId: string,
  input: ManualLeadInput,
  now = new Date(),
): Promise<{ leadId: string; deduped: boolean }> {
  const result = await upsertLeadWithinWindow({
    workspaceId,
    dedupeKey: buildLeadDedupeKey(input.phone, input.email),
    now,
    mode: "manual",
    fields: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      serviceInterest: input.serviceInterest,
      preferredTime: input.preferredTime,
      selfReportedSource: input.selfReportedSource,
      message: input.message,
    },
    create: { source: "manual" },
    touch: { lastManualAt: now.toISOString() },
  });
  return { leadId: result.leadId, deduped: result.deduped };
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

/**
 * 状态流转写哪些时间戳：只补空的，不覆盖、不清空（改回去也保留历史时间）。
 * 已联系 / 已预约 / 已成交都意味着联系过；已预约补 bookedAt；已成交补 wonAt。
 */
export function leadStatusTransitionData(
  current: { contactedAt: Date | null; bookedAt: Date | null; wonAt: Date | null },
  next: LeadStatus,
  now: Date,
): Prisma.LeadUpdateManyMutationInput {
  const data: Prisma.LeadUpdateManyMutationInput = { status: next };
  if ((next === "CONTACTED" || next === "BOOKED" || next === "WON") && !current.contactedAt) data.contactedAt = now;
  if (next === "BOOKED" && !current.bookedAt) data.bookedAt = now;
  if (next === "WON" && !current.wonAt) data.wonAt = now;
  return data;
}

export async function transitionLeadStatus(
  workspaceId: string,
  leadId: string,
  next: LeadStatus,
  now = new Date(),
): Promise<void> {
  const lead = await db.lead.findFirst({
    where: { id: leadId, workspaceId, archivedAt: null },
    select: { status: true, contactedAt: true, bookedAt: true, wonAt: true },
  });
  if (!lead) throw new LeadNotFoundError();
  if (lead.status === next) return;
  /// CAS：只在状态仍是刚读到的那个时写入，两个人同时改不会互相覆盖时间戳
  const result = await db.lead.updateMany({
    where: { id: leadId, workspaceId, archivedAt: null, status: lead.status },
    data: leadStatusTransitionData(lead, next, now),
  });
  if (result.count === 0) throw new LeadConflictError();
}

export async function setLeadVerified(workspaceId: string, leadId: string, verified: boolean, now = new Date()) {
  const result = await db.lead.updateMany({
    where: { id: leadId, workspaceId, archivedAt: null },
    data: { verifiedAt: verified ? now : null },
  });
  if (result.count === 0) throw new LeadNotFoundError();
}

/** 归档：不再计入读数与列表，记录保留（铁律：只归档不删除）。 */
export async function archiveLead(workspaceId: string, leadId: string, now = new Date()) {
  const result = await db.lead.updateMany({
    where: { id: leadId, workspaceId, archivedAt: null },
    data: { archivedAt: now },
  });
  if (result.count === 0) throw new LeadNotFoundError();
}

// ─────────────────────────────────────────────────────────────
// 工作台读数与列表
// ─────────────────────────────────────────────────────────────

export type SourceGroup = { source: string; trackedLinkId: string | null; count: number };

/** 来源归并：追踪链接按渠道算（IG 主页 / Google 商家…），其余按 source。 */
export function sourceKeyFor(group: { source: string; trackedLinkId: string | null }, channelById: Map<string, string | null>): string {
  if (group.source === "tracked_link" && group.trackedLinkId) {
    return `channel:${channelById.get(group.trackedLinkId) ?? "other"}`;
  }
  return group.source;
}

export function pickTopSource(
  groups: SourceGroup[],
  channelById: Map<string, string | null>,
): { key: string; count: number; total: number } | null {
  const tally = new Map<string, number>();
  let total = 0;
  for (const group of groups) {
    const key = sourceKeyFor(group, channelById);
    tally.set(key, (tally.get(key) ?? 0) + group.count);
    total += group.count;
  }
  let top: { key: string; count: number } | null = null;
  for (const [key, count] of tally) {
    /// 同票取 key 字典序，保证同一份数据每次显示同一个来源
    if (!top || count > top.count || (count === top.count && key < top.key)) top = { key, count };
  }
  return top && total > 0 ? { ...top, total } : null;
}

export type LeadsDashboard = Awaited<ReturnType<typeof loadLeadsDashboard>>;

export async function loadLeadsDashboard(workspaceId: string, now = new Date()) {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const [inquiries7, inquiries30, clicks7, clicks30, sourceGroups, leads, links] = await Promise.all([
    db.lead.count({ where: { workspaceId, archivedAt: null, createdAt: { gte: since7 } } }),
    db.lead.count({ where: { workspaceId, archivedAt: null, createdAt: { gte: since30 } } }),
    db.linkClick.count({ where: { isBot: false, createdAt: { gte: since7 }, trackedLink: { workspaceId } } }),
    db.linkClick.count({ where: { isBot: false, createdAt: { gte: since30 }, trackedLink: { workspaceId } } }),
    db.lead.groupBy({
      by: ["source", "trackedLinkId"],
      where: { workspaceId, archivedAt: null, createdAt: { gte: since30 } },
      _count: { _all: true },
    }),
    db.lead.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        source: true,
        name: true,
        phone: true,
        email: true,
        serviceInterest: true,
        preferredTime: true,
        selfReportedSource: true,
        message: true,
        status: true,
        contactedAt: true,
        bookedAt: true,
        wonAt: true,
        verifiedAt: true,
        createdAt: true,
        trackedLink: { select: { label: true, channel: true } },
      },
    }),
    db.trackedLink.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, code: true, label: true, channel: true, destinationUrl: true, clickCount: true, createdAt: true },
    }),
  ]);

  const linkIds = [...new Set(sourceGroups.flatMap((group) => (group.trackedLinkId ? [group.trackedLinkId] : [])))];
  /// 已停用的链接不在 links 里，但它带来的询盘仍按它的渠道算
  const channelRows = linkIds.length
    ? await db.trackedLink.findMany({ where: { id: { in: linkIds } }, select: { id: true, channel: true } })
    : [];
  const topSource = pickTopSource(
    sourceGroups.map((group) => ({ source: group.source, trackedLinkId: group.trackedLinkId, count: group._count._all })),
    new Map(channelRows.map((row) => [row.id, row.channel])),
  );

  return { inquiries7, inquiries30, clicks7, clicks30, topSource, leads, links };
}

// ─────────────────────────────────────────────────────────────
// 询盘页设置：商家改展示内容；地址 / 开通 / 跳转域名只归超管
// ─────────────────────────────────────────────────────────────

export const leadPageDisplayInputSchema = z.object({
  businessName: optionalText(80),
  headline: optionalText(120),
  intro: optionalText(600),
  services: z
    .array(z.string().trim().max(60))
    .max(12)
    .nullish()
    /// 去空、去重：重复的服务项会在公开页上渲染成重复条目
    .transform((value) => [...new Set((value ?? []).filter(Boolean))]),
  phone: optionalPhone("phone_invalid"),
  region: optionalText(80),
  locale: z.enum(LOCALES).nullish().transform((value) => value ?? null),
});

export type LeadPageDisplayInput = z.infer<typeof leadPageDisplayInputSchema>;

function configToJson(config: LeadPageConfig): Prisma.InputJsonValue {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined && value !== null),
  ) as Prisma.InputJsonValue;
}

export async function updateLeadPageDisplay(workspaceId: string, input: LeadPageDisplayInput): Promise<LeadPageConfig> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { leadPageConfig: true } });
  if (!workspace) throw new LeadNotFoundError();
  const current = parseLeadPageConfig(workspace.leadPageConfig);
  const next: LeadPageConfig = {
    allowedHosts: current.allowedHosts,
    businessName: input.businessName ?? undefined,
    headline: input.headline ?? undefined,
    intro: input.intro ?? undefined,
    services: input.services.length ? input.services : undefined,
    phone: input.phone ?? undefined,
    region: input.region ?? undefined,
    locale: input.locale ?? undefined,
  };
  await db.workspace.update({ where: { id: workspaceId }, data: { leadPageConfig: configToJson(next) } });
  return next;
}

export class LeadSlugError extends Error {
  constructor(readonly reason: "invalid" | "reserved" | "taken" | "required" | "hosts_invalid") {
    super(`lead page slug ${reason}`);
    this.name = "LeadSlugError";
  }
}

export const leadPageAdminInputSchema = z.object({
  enabled: z.boolean(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(64)
    .nullish()
    .transform((value) => (value ? value : null)),
  allowedHosts: z.array(z.string().max(253)).max(10).nullish().transform((value) => value ?? []),
});

export type LeadPageAdminInput = z.infer<typeof leadPageAdminInputSchema>;

/** 超管：开通 / 关闭询盘页、设地址与允许跳转的商家域名。 */
export async function updateWorkspaceLeadPageAdmin(workspaceId: string, input: LeadPageAdminInput) {
  if (input.slug) {
    const problem = checkLeadSlug(input.slug);
    if (problem) throw new LeadSlugError(problem);
  }
  if (input.enabled && !input.slug) throw new LeadSlugError("required");
  const hosts: string[] = [];
  for (const raw of input.allowedHosts) {
    if (!raw.trim()) continue;
    const host = normalizeAllowedHost(raw);
    if (!host) throw new LeadSlugError("hosts_invalid");
    if (!hosts.includes(host)) hosts.push(host);
  }
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { leadPageConfig: true } });
  if (!workspace) throw new LeadNotFoundError();
  const config = { ...parseLeadPageConfig(workspace.leadPageConfig), allowedHosts: hosts };
  try {
    return await db.workspace.update({
      where: { id: workspaceId },
      data: { publicSlug: input.slug, leadPageEnabled: input.enabled, leadPageConfig: configToJson(config) },
      select: { id: true, name: true, publicSlug: true, leadPageEnabled: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new LeadSlugError("taken");
    }
    throw error;
  }
}

export type AdminLeadPageWorkspace = {
  id: string;
  name: string;
  ownerEmail: string;
  publicSlug: string | null;
  leadPageEnabled: boolean;
  allowedHosts: string[];
};

export async function findLeadPageWorkspaceByOwnerEmail(email: string): Promise<AdminLeadPageWorkspace | null> {
  const owner = await db.adminUser.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      email: true,
      workspace: { select: { id: true, name: true, publicSlug: true, leadPageEnabled: true, leadPageConfig: true } },
    },
  });
  if (!owner?.workspace) return null;
  return {
    id: owner.workspace.id,
    name: owner.workspace.name,
    ownerEmail: owner.email,
    publicSlug: owner.workspace.publicSlug,
    leadPageEnabled: owner.workspace.leadPageEnabled,
    allowedHosts: allowedHostsFromConfig(owner.workspace.leadPageConfig),
  };
}

export async function listLeadPageWorkspaces(): Promise<AdminLeadPageWorkspace[]> {
  const rows = await db.workspace.findMany({
    where: { OR: [{ leadPageEnabled: true }, { publicSlug: { not: null } }] },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      publicSlug: true,
      leadPageEnabled: true,
      leadPageConfig: true,
      owner: { select: { email: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerEmail: row.owner.email,
    publicSlug: row.publicSlug,
    leadPageEnabled: row.leadPageEnabled,
    allowedHosts: allowedHostsFromConfig(row.leadPageConfig),
  }));
}

// ─────────────────────────────────────────────────────────────
// 试点申请（公开首页；Aivora 自己的获客，不属于任何工作区）
// ─────────────────────────────────────────────────────────────

/**
 * 返回 notify：全站这一小时过了繁忙线就照收不发邮件（创始人在后台列表里看得到），
 * 只有过了安全阀才抛限流错误——几个地址刷爆全局桶锁不住真申请人。
 */
export async function submitPilotApplication(
  input: PilotApplicationInput,
  context: { visitorHash: string; now?: Date },
): Promise<{ id: string; notify: boolean }> {
  const now = context.now ?? new Date();
  const window = hourlyWindowKey(now);
  await bumpRateLimit(`public-pilot:${context.visitorHash}`, window, PUBLIC_PILOT_VISITOR_HOURLY_MAX);
  const globalHits = await countRateLimitHit("public-pilot-global", window);
  if (globalHits > PUBLIC_PILOT_GLOBAL_HOURLY_HARD_MAX) throw new RateLimitExceededError();
  const locale: Locale = input.locale ?? "zh-CN";
  const row = await db.pilotApplication.create({
    data: {
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      whatsapp: input.whatsapp,
      wechat: input.wechat,
      website: input.website,
      industry: input.industry,
      city: input.city,
      monthlyLeadSpend: input.monthlyLeadSpend,
      message: input.message,
      locale,
      source: "website",
      /// 逐渠道同意 + 当时展示的同意文本与版本（举证用）
      consentJson: {
        version: input.consentVersion,
        acceptedAt: now.toISOString(),
        locale,
        text: pilotConsentText(locale),
        channels: {
          email: Boolean(input.email),
          phone: Boolean(input.phone),
          whatsapp: Boolean(input.whatsapp),
          wechat: Boolean(input.wechat),
        },
      },
    },
    select: { id: true },
  });
  return { id: row.id, notify: globalHits <= PUBLIC_PILOT_GLOBAL_HOURLY_NOTIFY_MAX };
}

export async function listPilotApplications(take = 100) {
  return db.pilotApplication.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      name: true,
      company: true,
      email: true,
      phone: true,
      whatsapp: true,
      wechat: true,
      website: true,
      industry: true,
      city: true,
      monthlyLeadSpend: true,
      message: true,
      source: true,
      status: true,
      createdAt: true,
    },
  });
}

/** 壳层角标胶水用：未归档的新询盘条数。 */
export async function countNewLeads(workspaceId: string): Promise<number> {
  return db.lead.count({ where: { workspaceId, archivedAt: null, status: "NEW" } });
}
