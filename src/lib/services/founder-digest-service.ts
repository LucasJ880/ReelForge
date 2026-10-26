import { db } from "@/lib/db";
import { getGrowthCopy, labelFor } from "@/i18n/growth-copy";
import { classifyCustomerGenerationError } from "@/lib/api/customer-generation-error";
import { founderNotifyEmail } from "@/lib/config/contact";
import {
  countNeedsAttention,
  NEEDS_ATTENTION_WINDOW_DAYS,
  needsAttentionSince,
  platformBatchFailureWhere,
  platformOrderFailureWhere,
} from "@/lib/services/exchange-readings";
import { appBaseUrl, emailConfig, sendEmail } from "@/lib/services/notification-service";
import { countRateLimitHit, dailyWindowKey } from "@/lib/services/rate-limit-service";

/**
 * 创始人每日汇总（2026-10-25 审计 B8）。
 *
 * 没配 Resend 时，试点申请与询盘不会给创始人任何信号。每天一封纯文本汇总，过去 24 小时：
 * 新试点申请、询盘页新询盘、失败的视频，以及各账号当前「需要处理」的条数。
 *
 *  - 全部只读查询；失败 / 需要处理的口径直接复用 exchange-readings（取消不算失败、按失败那一刻落窗）；
 *  - 发信走 notification-service 的同一条路（Resend REST），收件人 founderNotifyEmail()；
 *  - 没配 RESEND_API_KEY / EMAIL_FROM：把汇总打进日志，返回 { sent: false, reason: "not_configured" }（路由照样 200）；
 *    日志版不写联系方式与客户姓名、邮箱打码（与展台中继「日志只打计数」、通知服务同一个纪律），
 *    明细到 /app/leads 看；发给创始人的邮件版才带完整联系方式（与试点申请提醒邮件一致）；
 *  - 按 UTC 日幂等：复用 RateLimitBucket（bucketKey = founder-digest:sent，windowKey = UTC 日期）当「当天已发」闩锁——
 *    先原子占位、占到才发；cron 重试 / 重复触发拿不到位就不发。发送失败会把闩锁放回，下一次触发可以补发。
 *    不新增表。
 */

export const FOUNDER_DIGEST_WINDOW_HOURS = 24;
export const FOUNDER_DIGEST_BUCKET = "founder-digest:sent";
/** 每一节最多列几行（总数照实写）。 */
export const FOUNDER_DIGEST_LIST_LIMIT = 20;
/** 「需要处理」最多核对几个账号（按近 7 天出过失败的账号找候选）。 */
const NEEDS_ATTENTION_ACCOUNT_LIMIT = 50;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 询盘页（含经追踪链接进来的）提交的询盘；展位导入 / 手工登记不算「新询盘页询盘」。 */
const LEAD_PAGE_SOURCES = ["lead_page", "tracked_link"];

export type FounderDigestData = {
  windowStart: Date;
  windowEnd: Date;
  pilotApplications: {
    total: number;
    items: Array<{
      createdAt: Date;
      who: string;
      /** 公司名（日志版只写它，不写个人称呼与联系方式）。 */
      company: string | null;
      industry: string | null;
      city: string | null;
      contacts: string[];
      /** 留了哪几种联系方式（邮箱 / 电话 / WhatsApp / 微信），日志版用它代替原值。 */
      contactKinds: string[];
      source: string | null;
    }>;
  };
  leads: {
    total: number;
    items: Array<{
      createdAt: Date;
      workspace: string;
      name: string;
      source: string;
      serviceInterest: string | null;
    }>;
  };
  failedVideos: {
    single: number;
    batch: number;
    items: Array<{ at: Date; kind: "single" | "batch"; owner: string | null; title: string; reason: string }>;
  };
  needsAttention: Array<{ owner: string; workspace: string | null; count: number }>;
  /** C1：窗口内自助注册的新账号（首页「免费试做」入口）。 */
  signups: {
    total: number;
    items: Array<{ createdAt: Date; email: string; workspace: string; industry: string | null; city: string | null }>;
  };
  /** C1：申请了开通询盘页、还没开通的工作区——不限窗口，每一条都等你处理。 */
  activationRequests: Array<{ requestedAt: Date; workspace: string; owner: string }>;
};

export type FounderDigestCounts = {
  pilotApplications: number;
  leads: number;
  failedVideos: number;
  needsAttentionAccounts: number;
  needsAttentionItems: number;
  signups: number;
  activationRequests: number;
};

export function digestCounts(data: FounderDigestData): FounderDigestCounts {
  return {
    pilotApplications: data.pilotApplications.total,
    leads: data.leads.total,
    failedVideos: data.failedVideos.single + data.failedVideos.batch,
    needsAttentionAccounts: data.needsAttention.length,
    needsAttentionItems: data.needsAttention.reduce((sum, row) => sum + row.count, 0),
    signups: data.signups.total,
    activationRequests: data.activationRequests.length,
  };
}

/* ── 取数（只读） ─────────────────────────────────────────────────────── */

export async function loadFounderDigestData(now = new Date()): Promise<FounderDigestData> {
  const windowStart = new Date(now.getTime() - FOUNDER_DIGEST_WINDOW_HOURS * HOUR_MS);
  const range = { gte: windowStart, lt: now };
  const leadWhere = { createdAt: range, archivedAt: null, source: { in: LEAD_PAGE_SOURCES } };
  const pilotWhere = { createdAt: range, archivedAt: null };

  const signupWhere = { createdAt: range, role: "CUSTOMER" as const };
  const [pilotRows, pilotTotal, leadRows, leadTotal, batchRows, batchTotal, briefRows, briefTotal, needsAttention, signupRows, signupTotal, requestRows] =
    await Promise.all([
      db.pilotApplication.findMany({
        where: pilotWhere,
        orderBy: { createdAt: "desc" },
        take: FOUNDER_DIGEST_LIST_LIMIT,
        select: {
          createdAt: true,
          name: true,
          company: true,
          email: true,
          phone: true,
          whatsapp: true,
          wechat: true,
          industry: true,
          city: true,
          source: true,
        },
      }),
      db.pilotApplication.count({ where: pilotWhere }),
      db.lead.findMany({
        where: leadWhere,
        orderBy: { createdAt: "desc" },
        take: FOUNDER_DIGEST_LIST_LIMIT,
        select: {
          createdAt: true,
          name: true,
          source: true,
          serviceInterest: true,
          workspace: { select: { name: true } },
        },
      }),
      db.lead.count({ where: leadWhere }),
      db.videoJob.findMany({
        where: platformBatchFailureWhere(range),
        orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
        take: FOUNDER_DIGEST_LIST_LIMIT,
        select: {
          batchIndex: true,
          status: true,
          submissionState: true,
          submissionErrorClass: true,
          errorMessage: true,
          userSafeError: true,
          finishedAt: true,
          updatedAt: true,
          batchJob: {
            select: {
              productName: true,
              user: { select: { email: true } },
              template: { select: { nameZh: true, name: true } },
            },
          },
        },
      }),
      db.videoJob.count({ where: platformBatchFailureWhere(range) }),
      db.videoBrief.findMany({
        where: platformOrderFailureWhere(range),
        orderBy: { updatedAt: "desc" },
        take: FOUNDER_DIGEST_LIST_LIMIT,
        select: {
          errorMessage: true,
          updatedAt: true,
          finalVideo: { select: { status: true, finishedAt: true } },
          contentAngle: {
            select: {
              round: {
                select: { deliveryOrder: { select: { title: true, createdBy: { select: { email: true } } } } },
              },
            },
          },
        },
      }),
      db.videoBrief.count({ where: platformOrderFailureWhere(range) }),
      loadNeedsAttentionAccounts(now),
      db.adminUser.findMany({
        where: signupWhere,
        orderBy: { createdAt: "desc" },
        take: FOUNDER_DIGEST_LIST_LIMIT,
        select: { createdAt: true, email: true, workspace: { select: { name: true, businessProfile: true } } },
      }),
      db.adminUser.count({ where: signupWhere }),
      db.workspace.findMany({
        where: { leadPageRequestedAt: { not: null }, leadPageEnabled: false },
        orderBy: { leadPageRequestedAt: "asc" },
        take: FOUNDER_DIGEST_LIST_LIMIT,
        select: { name: true, leadPageRequestedAt: true, owner: { select: { email: true } } },
      }),
    ]);

  const failedItems: FounderDigestData["failedVideos"]["items"] = [
    ...batchRows.map((job) => {
      const template = job.batchJob?.template;
      const templateName = template ? (template.nameZh ?? template.name) : "";
      const error = classifyCustomerGenerationError({
        status: job.status,
        submissionState: job.submissionState,
        submissionErrorClass: job.submissionErrorClass,
        errorMessage: job.errorMessage,
        userSafeError: job.userSafeError,
      });
      return {
        at: job.finishedAt ?? job.updatedAt,
        kind: "batch" as const,
        owner: job.batchJob?.user.email ?? null,
        title: `${job.batchJob?.productName ?? templateName} #${(job.batchIndex ?? 0) + 1}${templateName ? ` · ${templateName}` : ""}`,
        reason: error?.message ?? "视频生成失败。",
      };
    }),
    ...briefRows.map((brief) => {
      const order = brief.contentAngle.round.deliveryOrder;
      const error = classifyCustomerGenerationError({ status: "FAILED", errorMessage: brief.errorMessage });
      const finalFailedAt = brief.finalVideo?.status === "FAILED" ? brief.finalVideo.finishedAt : null;
      return {
        at: finalFailedAt ?? brief.updatedAt,
        kind: "single" as const,
        owner: order.createdBy?.email ?? null,
        title: order.title,
        reason: error?.message ?? "视频生成失败。",
      };
    }),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, FOUNDER_DIGEST_LIST_LIMIT);

  return {
    windowStart,
    windowEnd: now,
    pilotApplications: {
      total: pilotTotal,
      items: pilotRows.map((row) => ({
        createdAt: row.createdAt,
        who: row.company ?? row.name ?? row.email ?? row.phone ?? row.whatsapp ?? row.wechat ?? "—",
        company: row.company,
        industry: row.industry,
        city: row.city,
        contacts: [
          row.email,
          row.phone,
          row.whatsapp ? `WhatsApp ${row.whatsapp}` : null,
          row.wechat ? `微信 ${row.wechat}` : null,
        ].filter((value): value is string => Boolean(value && value.trim())),
        contactKinds: [
          row.email?.trim() ? "邮箱" : null,
          row.phone?.trim() ? "电话" : null,
          row.whatsapp?.trim() ? "WhatsApp" : null,
          row.wechat?.trim() ? "微信" : null,
        ].filter((value): value is string => Boolean(value)),
        source: row.source,
      })),
    },
    leads: {
      total: leadTotal,
      items: leadRows.map((row) => ({
        createdAt: row.createdAt,
        workspace: row.workspace.name,
        name: row.name,
        source: row.source,
        serviceInterest: row.serviceInterest,
      })),
    },
    failedVideos: { single: briefTotal, batch: batchTotal, items: failedItems },
    needsAttention,
    signups: {
      total: signupTotal,
      items: signupRows.map((row) => {
        const profile = (row.workspace?.businessProfile ?? {}) as { industry?: unknown; city?: unknown };
        return {
          createdAt: row.createdAt,
          email: row.email,
          workspace: row.workspace?.name ?? "—",
          industry: typeof profile.industry === "string" ? profile.industry : null,
          city: typeof profile.city === "string" ? profile.city : null,
        };
      }),
    },
    activationRequests: requestRows.map((row) => ({
      requestedAt: row.leadPageRequestedAt ?? now,
      workspace: row.name,
      owner: row.owner.email,
    })),
  };
}

/**
 * 各账号当前「需要处理」的条数：与导轨徽标同一个口径（近 7 天、「看过了」之后、取消不算）。
 * 候选 = 近 7 天出过失败的账号（批量按批次属主，单条按订单创建人）。
 */
async function loadNeedsAttentionAccounts(now: Date): Promise<FounderDigestData["needsAttention"]> {
  const week = { gte: new Date(now.getTime() - NEEDS_ATTENTION_WINDOW_DAYS * DAY_MS) };
  const [batchOwners, orderOwners] = await Promise.all([
    db.batchJob.findMany({
      where: { videoJobs: { some: platformBatchFailureWhere(week) } },
      select: { userId: true },
      distinct: ["userId"],
      take: NEEDS_ATTENTION_ACCOUNT_LIMIT,
    }),
    db.deliveryOrder.findMany({
      where: {
        productCategory: "unified_input",
        createdById: { not: null },
        rounds: { some: { angles: { some: { videoBrief: { is: platformOrderFailureWhere(week) } } } } },
      },
      select: { createdById: true },
      distinct: ["createdById"],
      take: NEEDS_ATTENTION_ACCOUNT_LIMIT,
    }),
  ]);
  const userIds = [
    ...new Set([
      ...batchOwners.map((row) => row.userId),
      ...orderOwners.map((row) => row.createdById).filter((id): id is string => Boolean(id)),
    ]),
  ].slice(0, NEEDS_ATTENTION_ACCOUNT_LIMIT);
  if (userIds.length === 0) return [];

  const users = await db.adminUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, workspace: { select: { name: true, failuresAckedAt: true } } },
  });
  const rows = await Promise.all(
    users.map(async (user) => ({
      owner: user.email,
      workspace: user.workspace?.name ?? null,
      count: await countNeedsAttention(user.id, needsAttentionSince(now, user.workspace?.failuresAckedAt)),
    })),
  );
  return rows.filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
}

/* ── 成文（纯函数） ─────────────────────────────────────────────────────── */

function utcStamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function utcShort(date: Date): string {
  return date.toISOString().slice(5, 16).replace("T", " ");
}

/** 日志版的邮箱打码：o***@example.com。 */
export function maskEmail(email: string | null): string {
  if (!email) return "—";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

function section(title: string, total: number, lines: string[], shown: number): string[] {
  if (total === 0) return [`${title}: 0`, "  无 / none", ""];
  const more = total > shown ? [`  … 另有 ${total - shown} 条 / ${total - shown} more`] : [];
  return [`${title}: ${total}`, ...lines.map((line) => `  - ${line}`), ...more, ""];
}

/**
 * 成文。redact = 日志版：不写联系方式与个人称呼、不写询盘人姓名、账号邮箱打码——
 * 只留「有几条、哪家、从哪来」的信号，明细到 /app/leads 看。
 */
export function buildFounderDigest(
  data: FounderDigestData,
  options: { day: string; baseUrl?: string | null; redact?: boolean },
): { subject: string; text: string } {
  const counts = digestCounts(data);
  const redact = options.redact === true;
  const zh = getGrowthCopy("zh-CN");
  const pilots = data.pilotApplications.items.map((item) => {
    const place = [item.industry, item.city].filter(Boolean).join(" · ");
    const who = redact ? (item.company ?? "个人申请") : item.who;
    const contacts = redact
      ? item.contactKinds.length > 0 ? `留了${item.contactKinds.join(" / ")}` : ""
      : item.contacts.join(" / ");
    return [
      utcShort(item.createdAt),
      place ? `${who}（${place}）` : who,
      contacts || "未留联系方式",
      item.source ? `来源 ${item.source}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });
  const leads = data.leads.items.map((item) =>
    [
      utcShort(item.createdAt),
      item.workspace,
      redact ? null : item.name,
      labelFor(zh.sources, item.source) ?? item.source,
      item.serviceInterest,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const owner = (email: string | null) => (redact ? maskEmail(email) : (email ?? "—"));
  const failed = data.failedVideos.items.map((item) =>
    [utcShort(item.at), item.kind === "single" ? "单条" : "批量", owner(item.owner), item.title, item.reason].join(" · "),
  );
  const attention = data.needsAttention.map((row) =>
    [owner(row.owner), row.workspace, `${row.count} 条`].filter(Boolean).join(" · "),
  );
  const signups = data.signups.items.map((item) =>
    [utcShort(item.createdAt), item.workspace, [item.industry, item.city].filter(Boolean).join(" · "), owner(item.email)]
      .filter(Boolean)
      .join(" · "),
  );
  const requests = data.activationRequests.map((item) =>
    [utcShort(item.requestedAt), item.workspace, owner(item.owner)].join(" · "),
  );
  const base = options.baseUrl?.replace(/\/+$/, "") ?? null;

  const text = [
    `Aivora 每日汇总 / Daily digest · ${options.day}（UTC）`,
    `窗口 / Window: ${utcStamp(data.windowStart)} → ${utcStamp(data.windowEnd)} UTC`,
    "",
    ...section("试点申请 / Pilot applications", counts.pilotApplications, pilots, pilots.length),
    ...section("询盘页新询盘 / New lead-page inquiries", counts.leads, leads, leads.length),
    ...section("自助注册（免费试做）/ New self-serve sign-ups", counts.signups, signups, signups.length),
    ...section(
      "待开通的询盘页（不限窗口，管理员面板开通）/ Inquiry pages awaiting activation",
      counts.activationRequests,
      requests,
      requests.length,
    ),
    ...section(
      `失败的视频 / Failed videos（单条 ${data.failedVideos.single} · 批量 ${data.failedVideos.batch}）`,
      counts.failedVideos,
      failed,
      failed.length,
    ),
    ...section(
      `需要处理（账号，口径同导轨徽标：近 ${NEEDS_ATTENTION_WINDOW_DAYS} 天未处理的失败）/ Needs attention (accounts)`,
      counts.needsAttentionAccounts,
      attention,
      attention.length,
    ),
    "取消的视频不算失败；数字只读自生产库，不含示例数据。",
    redact ? "（日志版：联系方式与姓名不写进日志，明细见询盘页）" : "",
    base ? `询盘与试点申请：${base}/app/leads` : "",
  ]
    .join("\n")
    .trim();

  const subject = `Aivora 每日汇总 ${options.day} · 试点 ${counts.pilotApplications} · 询盘 ${counts.leads} · 失败 ${counts.failedVideos} · 需处理 ${counts.needsAttentionItems}`;
  return { subject, text };
}

/* ── 编排 ─────────────────────────────────────────────────────────────── */

export type FounderDigestOutcome =
  | { sent: true; day: string; counts: FounderDigestCounts }
  | { sent: false; reason: "not_configured" | "send_failed"; day: string; counts: FounderDigestCounts }
  | { sent: false; reason: "already_sent"; day: string };

export type FounderDigestDeps = {
  load: (now: Date) => Promise<FounderDigestData>;
  /** 占当天的发送闩锁：第一个占到的返回 true。 */
  claimDay: (day: string) => Promise<boolean>;
  /** 发送失败时把闩锁放回，下一次触发可以补发。 */
  releaseDay: (day: string) => Promise<void>;
  send: typeof sendEmail;
  log: (message: string) => void;
};

async function claimDigestDay(day: string): Promise<boolean> {
  return (await countRateLimitHit(FOUNDER_DIGEST_BUCKET, day)) === 1;
}

async function releaseDigestDay(day: string): Promise<void> {
  await db.rateLimitBucket.updateMany({
    where: { bucketKey: FOUNDER_DIGEST_BUCKET, windowKey: day },
    data: { count: 0 },
  });
}

const DEFAULT_DEPS: FounderDigestDeps = {
  load: loadFounderDigestData,
  claimDay: claimDigestDay,
  releaseDay: releaseDigestDay,
  send: sendEmail,
  log: (message) => console.info(message),
};

export async function runFounderDigest(
  options: { now?: Date; env?: NodeJS.ProcessEnv; deps?: Partial<FounderDigestDeps> } = {},
): Promise<FounderDigestOutcome> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const deps = { ...DEFAULT_DEPS, ...options.deps };
  const day = dailyWindowKey(now);
  const config = emailConfig(env);

  if (!config) {
    const data = await deps.load(now);
    const digest = buildFounderDigest(data, { day, baseUrl: appBaseUrl(env), redact: true });
    deps.log(`[founder-digest] 未配置 RESEND_API_KEY / EMAIL_FROM，汇总只记日志：\n${digest.subject}\n${digest.text}`);
    return { sent: false, reason: "not_configured", day, counts: digestCounts(data) };
  }

  if (!(await deps.claimDay(day))) return { sent: false, reason: "already_sent", day };

  const release = () =>
    deps.releaseDay(day).catch((error: unknown) => {
      console.warn("[founder-digest] could not release today's latch", {
        day,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  let data: FounderDigestData;
  try {
    data = await deps.load(now);
  } catch (error) {
    /// 取数失败：闩锁放回，让下一次触发重来；错误照常抛给路由（500）。
    await release();
    throw error;
  }
  const counts = digestCounts(data);
  const digest = buildFounderDigest(data, { day, baseUrl: appBaseUrl(env) });
  let ok = false;
  try {
    ok = await deps.send({ to: [founderNotifyEmail(env)], subject: digest.subject, text: digest.text }, config);
  } catch (error) {
    console.warn("[founder-digest] send failed", { day, error: error instanceof Error ? error.message : String(error) });
  }
  if (ok) return { sent: true, day, counts };
  await release();
  return { sent: false, reason: "send_failed", day, counts };
}
