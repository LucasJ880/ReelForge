import { after } from "next/server";
import { db } from "@/lib/db";
import { getGrowthCopy, labelFor } from "@/i18n/growth-copy";

/**
 * 新询盘 / 试点申请的通知（计划 D8）。
 *
 *  - 配了 RESEND_API_KEY + EMAIL_FROM 才发邮件：直接调 Resend REST，不引 SDK。
 *  - 没配就只打一行日志（站内角标与每日汇总兜底）；发信 key 与域名 DNS 是创始人提供的外部依赖。
 *  - 发送成功才写 notifiedAt（条件更新，重复调用不重复写）；任何失败都只记日志、绝不抛出——
 *    表单提交永远不被邮件拖住（路由里用 runAfterResponse 在响应之后跑）。
 *  - 正文只用纯文本：不带样式，也就不会把颜色字面量带进源码。
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 8_000;

export type NotifyOutcome =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "no_recipient" | "already_notified" | "not_found" | "send_failed" };

type EmailConfig = { apiKey: string; from: string };

export function emailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

export function founderEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.AIVORA_FOUNDER_EMAIL?.trim();
  return value ? value : null;
}

function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = (env.APP_BASE_URL || env.NEXT_PUBLIC_APP_URL)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
}

/** 主题行不能带换行（邮件头注入），也别太长。 */
export function safeSubject(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 140);
}

export async function sendEmail(
  message: { to: string[]; bcc?: string[]; subject: string; text: string },
  config: EmailConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.from,
      to: message.to,
      ...(message.bcc && message.bcc.length ? { bcc: message.bcc } : {}),
      subject: safeSubject(message.subject),
      text: message.text,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    /// 不把 Resend 的响应体整段打进日志（可能回显收件人）；状态码足够排查
    console.warn("[notify] resend rejected", { status: response.status });
  }
  return response.ok;
}

function lines(entries: Array<[string, string | null | undefined]>): string {
  return entries
    .filter(([, value]) => Boolean(value && value.trim()))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

type NotifyDeps = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: Date };

/** 新询盘 → 商家（工作区 owner），创始人密送（试点期白手套跟进）。 */
export async function notifyNewLead(leadId: string, deps: NotifyDeps = {}): Promise<NotifyOutcome> {
  const env = deps.env ?? process.env;
  try {
    const config = emailConfig(env);
    if (!config) {
      console.info("[notify] 未配置 RESEND_API_KEY / EMAIL_FROM，跳过新询盘邮件", { leadId });
      return { sent: false, reason: "not_configured" };
    }
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        serviceInterest: true,
        preferredTime: true,
        selfReportedSource: true,
        message: true,
        source: true,
        notifiedAt: true,
        trackedLink: { select: { label: true, channel: true } },
        workspace: { select: { name: true, owner: { select: { email: true, disabledAt: true } } } },
      },
    });
    if (!lead) return { sent: false, reason: "not_found" };
    if (lead.notifiedAt) return { sent: false, reason: "already_notified" };

    /// owner 账号已停用：访客的姓名电话不再发给这个被平台切断的账号，只回落给创始人（没配就不发）
    const ownerEmail = lead.workspace.owner.disabledAt ? null : lead.workspace.owner.email;
    const founder = founderEmail(env);
    const to = ownerEmail ? [ownerEmail] : founder ? [founder] : [];
    if (to.length === 0) return { sent: false, reason: "no_recipient" };
    const bcc = founder && !to.includes(founder) ? [founder] : [];

    /// 邮件双语：商家可能用中文或英文界面，标签两种都写
    const zh = getGrowthCopy("zh-CN");
    const en = getGrowthCopy("en-US");
    const source = lead.trackedLink
      ? `${zh.sources.tracked_link} / ${en.sources.tracked_link} · ${lead.trackedLink.label}${
          lead.trackedLink.channel ? ` (${labelFor(en.channels, lead.trackedLink.channel)})` : ""
        }`
      : `${labelFor(zh.sources, lead.source) ?? lead.source} / ${labelFor(en.sources, lead.source) ?? lead.source}`;
    const base = appBaseUrl(env);
    const text = [
      `新询盘 / New inquiry · ${lead.workspace.name}`,
      "",
      lines([
        ["姓名 / Name", lead.name],
        ["电话 / Phone", lead.phone],
        ["邮箱 / Email", lead.email],
        ["项目 / Request", lead.serviceInterest],
        ["方便时间 / Best time", labelFor(en.preferredTimes, lead.preferredTime)],
        ["自报来源 / Heard via", labelFor(en.selfReported, lead.selfReportedSource)],
        ["来源 / Source", source],
        ["留言 / Message", lead.message],
      ]),
      "",
      base ? `${base}/app/leads` : "",
    ]
      .join("\n")
      .trim();

    const ok = await sendEmail(
      {
        to,
        bcc,
        subject: `新询盘 New inquiry: ${lead.name}${lead.serviceInterest ? ` · ${lead.serviceInterest}` : ""}`,
        text,
      },
      config,
      deps.fetchImpl,
    );
    if (!ok) return { sent: false, reason: "send_failed" };
    await db.lead.updateMany({ where: { id: lead.id, notifiedAt: null }, data: { notifiedAt: deps.now ?? new Date() } });
    return { sent: true };
  } catch (error) {
    console.warn("[notify] new lead email failed", {
      leadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "send_failed" };
  }
}

/** 试点申请 → 创始人（AIVORA_FOUNDER_EMAIL）。没配收件人就只记日志。 */
export async function notifyPilotApplication(applicationId: string, deps: NotifyDeps = {}): Promise<NotifyOutcome> {
  const env = deps.env ?? process.env;
  try {
    const config = emailConfig(env);
    if (!config) {
      console.info("[notify] 未配置 RESEND_API_KEY / EMAIL_FROM，跳过试点申请邮件", { applicationId });
      return { sent: false, reason: "not_configured" };
    }
    const founder = founderEmail(env);
    if (!founder) {
      console.info("[notify] 未配置 AIVORA_FOUNDER_EMAIL，跳过试点申请邮件", { applicationId });
      return { sent: false, reason: "no_recipient" };
    }
    const application = await db.pilotApplication.findUnique({
      where: { id: applicationId },
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
        locale: true,
        source: true,
        notifiedAt: true,
      },
    });
    if (!application) return { sent: false, reason: "not_found" };
    if (application.notifiedAt) return { sent: false, reason: "already_notified" };

    const en = getGrowthCopy("en-US");
    const who = application.company ?? application.name ?? application.email ?? application.phone ?? "—";
    const base = appBaseUrl(env);
    const text = [
      "试点申请 / Pilot application",
      "",
      lines([
        ["称呼 / Name", application.name],
        ["公司 / Business", application.company],
        ["行业 / Industry", application.industry],
        ["城市 / City", application.city],
        ["邮箱 / Email", application.email],
        ["电话 / Phone", application.phone],
        ["WhatsApp", application.whatsapp],
        ["微信 / WeChat", application.wechat],
        ["网站 / Website", application.website],
        ["获客月花费 / Monthly spend", labelFor(en.spend, application.monthlyLeadSpend)],
        ["留言 / Message", application.message],
        ["语言 / Locale", application.locale],
        ["来源 / Source", application.source],
      ]),
      "",
      base ? `${base}/app/leads` : "",
    ]
      .join("\n")
      .trim();

    const ok = await sendEmail(
      { to: [founder], subject: `试点申请 Pilot application: ${who}`, text },
      config,
      deps.fetchImpl,
    );
    if (!ok) return { sent: false, reason: "send_failed" };
    await db.pilotApplication.updateMany({
      where: { id: application.id, notifiedAt: null },
      data: { notifiedAt: deps.now ?? new Date() },
    });
    return { sent: true };
  } catch (error) {
    console.warn("[notify] pilot application email failed", {
      applicationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "send_failed" };
  }
}

/**
 * 在响应发出之后再跑（Vercel 上函数会等它跑完）；不在请求作用域里（脚本、测试）就直接异步跑。
 * 任务本身吞掉异常，这里只兜底。
 */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const guarded = () => task().catch(() => undefined);
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
