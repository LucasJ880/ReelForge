import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  countRateLimitHit,
  hashVisitorKey,
  hashVisitorNetwork,
  hourlyWindowKey,
} from "@/lib/services/rate-limit-service";
import { TRACKED_LINK_CHANNELS, type TrackedLinkChannel } from "@/i18n/growth-copy";

/**
 * 追踪链接 /t/[code]（计划 6.3 / D4）。
 *
 *  - 只对管理员开通了询盘页、且 owner 账号未停用的工作区生效（leadPageEnabled + publicSlug），否则 404。
 *  - 跳转目标只有两种：本工作区询盘页（带 ?t=code 归因），或超管登记过的 https 商家域名
 *    （leadPageConfig.allowedHosts）。不在名单里的一律回落到询盘页——不做开放跳转。
 *  - 点击日志只记来源域名、是否爬虫、UA 家族；不存 IP 与完整 UA。
 *  - 链接预览爬虫 / HEAD 只记录不计数；同一访客（IP + UA 的单向哈希）30 分钟内只记一次。
 *  - 单一网段（IPv4 /24、IPv6 /48）每条链接每小时最多记 CLICK_LOG_NETWORK_HOURLY_MAX 次，超了只跳转不记。
 */

/// 与 middleware 放行的 /t/<code> 段完全一致（4–32 位 [A-Za-z0-9_-]）。
export const TRACKED_LINK_CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;

/// 生成的码去掉易混字符（0/O、1/l/I），印成二维码旁的短码也能念出来。
const CODE_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

export const CLICK_DEDUPE_MINUTES = 30;
/// 去重状态复用 RateLimitBucket（bucketKey 唯一 + updatedAt），不新增表。
const CLICK_DEDUPE_WINDOW = "click-dedupe";
/// 每个访客网段每条链接每小时最多记几次点击。小商家一条链接一小时里同一网段来 20 个不同的人已很罕见；
/// 超了也只是少记，跳转不受影响。
export const CLICK_LOG_NETWORK_HOURLY_MAX = 20;

export function generateTrackedLinkCode(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(CODE_LENGTH);
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}

export function isTrackedLinkChannel(value: unknown): value is TrackedLinkChannel {
  return typeof value === "string" && (TRACKED_LINK_CHANNELS as readonly string[]).includes(value);
}

/**
 * 链接预览爬虫与非浏览器客户端。WhatsApp / iMessage / Slack 等在消息里贴链接时会先抓一次，
 * 那不是人点的，不能算进点击。Instagram / Facebook 的内置浏览器（FBAN/FBAV、Instagram）是人，不在此列。
 */
const BOT_UA_PATTERNS: Array<[RegExp, string]> = [
  [/facebookexternalhit|facebookcatalog|meta-externalagent/i, "facebookexternalhit"],
  [/WhatsApp/i, "whatsapp"],
  [/Slackbot|Slack-ImgProxy/i, "slackbot"],
  /// Telegram 的 UA 是「TelegramBot (like TwitterBot)」，要排在 Twitterbot 前面
  [/TelegramBot/i, "telegrambot"],
  [/Twitterbot/i, "twitterbot"],
  [/Discordbot/i, "discordbot"],
  [/LinkedInBot/i, "linkedinbot"],
  [/Applebot/i, "applebot"],
  [/Googlebot|Google-InspectionTool|AdsBot-Google|Mediapartners-Google|GoogleOther/i, "googlebot"],
  [/bingbot|BingPreview/i, "bingbot"],
  [/Pinterestbot|redditbot|SkypeUriPreview|Embedly|Iframely|DuckDuckBot|YandexBot|Baiduspider|Bytespider/i, "preview-bot"],
  [/\bcurl\//i, "curl"],
  [/\bWget\//i, "wget"],
  [/python-requests|python-urllib|aiohttp|Go-http-client|okhttp|node-fetch|undici|axios\//i, "http-client"],
  [/HeadlessChrome|PhantomJS|Puppeteer|Playwright/i, "headless"],
  [/crawler|spider|\bbot\b|[a-z]bot\//i, "bot"],
];

const BROWSER_FAMILIES: Array<[RegExp, string]> = [
  [/Instagram/i, "instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "facebook"],
  [/MicroMessenger/i, "wechat"],
  [/musical_ly|TikTok|BytedanceWebview/i, "tiktok"],
  [/SamsungBrowser/i, "samsung"],
  [/Edg(?:e|A|iOS)?\//i, "edge"],
  [/Firefox|FxiOS/i, "firefox"],
  [/Chrome|CriOS|Chromium/i, "chrome"],
  [/Safari/i, "safari"],
];

export function classifyUserAgent(
  userAgent: string | null | undefined,
  method = "GET",
): { isBot: boolean; uaFamily: string } {
  const ua = (userAgent ?? "").trim();
  if (!ua) return { isBot: true, uaFamily: "empty" };
  for (const [pattern, family] of BOT_UA_PATTERNS) {
    if (pattern.test(ua)) return { isBot: true, uaFamily: family };
  }
  /// HEAD 是预取 / 探活，不是人点开：记录但不计数。
  if (method.toUpperCase() === "HEAD") return { isBot: true, uaFamily: "head" };
  for (const [pattern, family] of BROWSER_FAMILIES) {
    if (pattern.test(ua)) return { isBot: false, uaFamily: family };
  }
  return { isBot: false, uaFamily: "other" };
}

export function referrerHost(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return host ? host.slice(0, 255) : null;
  } catch {
    return null;
  }
}

/** 公开入口的访客 IP（只用于单向哈希；与注册路由取法一致）。 */
export function clientIpFromHeaders(headers: Headers): string | null {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    null
  );
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * 管理员登记的商家域名：只收裸域名（小写，不带协议 / 端口 / 路径）。
 * 写入前校验，读取时也再过一遍（库里历史值不可信）。
 */
export function normalizeAllowedHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  return HOSTNAME_RE.test(host) ? host : null;
}

export function allowedHostsFromConfig(config: Prisma.JsonValue | null | undefined): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const hosts = (config as Record<string, unknown>).allowedHosts;
  if (!Array.isArray(hosts)) return [];
  return hosts.flatMap((host) => {
    if (typeof host !== "string") return [];
    const normalized = normalizeAllowedHost(host);
    return normalized ? [normalized] : [];
  });
}

/**
 * 外部跳转目标：必须 https、默认端口、不带账号口令，且域名精确命中登记名单。
 * 不命中返回 null，由调用方回落到询盘页。
 */
export function resolveSafeDestination(
  destinationUrl: string | null | undefined,
  allowedHosts: readonly string[],
): string | null {
  if (!destinationUrl) return null;
  let url: URL;
  try {
    url = new URL(destinationUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) return null;
  return url.toString();
}

export function leadPagePath(slug: string, code?: string | null): string {
  const base = `/l/${encodeURIComponent(slug)}`;
  return code ? `${base}?t=${encodeURIComponent(code)}` : base;
}

/** 对外可分享的绝对地址：优先部署配置，其次当前请求的 Host。 */
export function publicBaseUrl(headers?: Headers | null): string {
  const configured = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const host = headers?.get("x-forwarded-host") ?? headers?.get("host");
  if (host) {
    const proto = headers?.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * 同一访客对同一链接 30 分钟内只记一次。原子：
 *  1) 已有且超过 30 分钟的记录 → 条件更新抢到即算新的一次（并发下只有一个请求命中条件）；
 *  2) 没有记录 → 插入，唯一约束冲突说明别的请求刚记过；
 *  3) 其余（30 分钟内已记过）→ 重复。
 *
 * 爬虫与真人分开去重：同一台手机先预取（HEAD / 预览）再真点开，IP 与 UA 都一样，
 * 共用一个槽的话预取会把真人那一下吞掉（本地真机复现过）。
 */
export async function claimClickSlot(
  linkId: string,
  visitorHash: string,
  now = new Date(),
  kind: "human" | "bot" = "human",
): Promise<boolean> {
  const bucketKey = `click:${linkId}:${kind}:${visitorHash}`;
  const cutoff = new Date(now.getTime() - CLICK_DEDUPE_MINUTES * 60 * 1000);
  const refreshed = await db.rateLimitBucket.updateMany({
    where: { bucketKey, windowKey: CLICK_DEDUPE_WINDOW, updatedAt: { lt: cutoff } },
    data: { count: { increment: 1 }, updatedAt: now },
  });
  if (refreshed.count > 0) return true;
  try {
    await db.rateLimitBucket.create({ data: { bucketKey, windowKey: CLICK_DEDUPE_WINDOW, count: 1 } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export type TrackedLinkVisit =
  | { status: "redirect"; location: string; counted: boolean; isBot: boolean }
  | { status: "not_found" };

/**
 * 单一来源的记点击闸。去重键带 UA，换一个 UA 就能绕开 30 分钟去重，所以另按访客网段
 * （IPv4 /24、IPv6 /48）封顶：每个网段每条链接每小时最多记 CLICK_LOG_NETWORK_HOURLY_MAX 次
 * （真人 + 爬虫合计，30 分钟内的重复点也占额度）。超了照样跳转，只是不记、不计——
 * 访客永远打得开链接，读数刷不上天，库里的行数也有上限。去重本身仍按 IP + UA，不误合并同一 NAT 后的真人。
 */
async function underClickLogCap(linkId: string, ip: string | null, now: Date): Promise<boolean> {
  const hits = await countRateLimitHit(`click-net:${linkId}:${hashVisitorNetwork(ip)}`, hourlyWindowKey(now));
  if (hits <= CLICK_LOG_NETWORK_HOURLY_MAX) return true;
  /// 每个网段每小时只在刚越线时记一行，被刷时不把日志也刷爆
  if (hits === CLICK_LOG_NETWORK_HOURLY_MAX + 1) {
    console.warn("[tracked-link] click log cap reached", { linkId, window: hourlyWindowKey(now) });
  }
  return false;
}

/**
 * /t/[code] 的全部决定：找链接 → 定跳转目标 → 记点击（失败不挡跳转）。
 * 返回的 location 是相对路径（询盘页）或已校验的 https 绝对地址。
 */
export async function handleTrackedLinkVisit(args: {
  code: string;
  method: string;
  userAgent: string | null;
  referer: string | null;
  ip: string | null;
  now?: Date;
}): Promise<TrackedLinkVisit> {
  if (!TRACKED_LINK_CODE_RE.test(args.code)) return { status: "not_found" };
  const link = await db.trackedLink.findUnique({
    where: { code: args.code },
    select: {
      id: true,
      archivedAt: true,
      destinationUrl: true,
      workspace: {
        select: {
          publicSlug: true,
          leadPageEnabled: true,
          leadPageConfig: true,
          owner: { select: { disabledAt: true } },
        },
      },
    },
  });
  /// 账号被停用：它的追踪链接与询盘页一起下线（恢复账号后自动重新生效，不改 leadPageEnabled）
  if (
    !link ||
    link.archivedAt ||
    !link.workspace.leadPageEnabled ||
    !link.workspace.publicSlug ||
    link.workspace.owner.disabledAt
  ) {
    return { status: "not_found" };
  }
  const location =
    resolveSafeDestination(link.destinationUrl, allowedHostsFromConfig(link.workspace.leadPageConfig)) ??
    leadPagePath(link.workspace.publicSlug, args.code);

  const { isBot, uaFamily } = classifyUserAgent(args.userAgent, args.method);
  const now = args.now ?? new Date();
  let counted = false;
  try {
    if (!(await underClickLogCap(link.id, args.ip, now))) {
      return { status: "redirect", location, counted: false, isBot };
    }
    const visitorHash = hashVisitorKey(`${args.ip ?? "unknown"}|${args.userAgent ?? ""}`);
    if (await claimClickSlot(link.id, visitorHash, now, isBot ? "bot" : "human")) {
      await db.linkClick.create({
        data: { trackedLinkId: link.id, referrerHost: referrerHost(args.referer), isBot, uaFamily },
      });
      if (!isBot) {
        await db.trackedLink.update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } });
        counted = true;
      }
    }
  } catch (error) {
    /// 记点击失败不能让访客打不开链接
    console.warn("[tracked-link] click log failed", {
      linkId: link.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { status: "redirect", location, counted, isBot };
}

export class TrackedLinkError extends Error {
  constructor(
    readonly code: "LEAD_PAGE_DISABLED" | "DESTINATION_NOT_ALLOWED" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "TrackedLinkError";
  }
}

export async function createTrackedLink(
  workspaceId: string,
  input: { label: string; channel: TrackedLinkChannel; destinationUrl?: string | null },
) {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { leadPageEnabled: true, publicSlug: true, leadPageConfig: true },
  });
  if (!workspace?.leadPageEnabled || !workspace.publicSlug) {
    throw new TrackedLinkError("LEAD_PAGE_DISABLED", "询盘页开通后才能建追踪链接");
  }
  let destinationUrl: string | null = null;
  if (input.destinationUrl) {
    destinationUrl = resolveSafeDestination(input.destinationUrl, allowedHostsFromConfig(workspace.leadPageConfig));
    if (!destinationUrl) {
      throw new TrackedLinkError("DESTINATION_NOT_ALLOWED", "跳转目标不在登记的 https 商家域名内");
    }
  }
  /// 8 位码的碰撞概率极低；撞上唯一约束就换一个，最多三次。
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.trackedLink.create({
        data: {
          workspaceId,
          code: generateTrackedLinkCode(),
          label: input.label,
          channel: input.channel,
          destinationUrl,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 2) continue;
      throw error;
    }
  }
}

/** 停用 = 归档（archivedAt），点击记录保留；不物理删除。 */
export async function archiveTrackedLink(workspaceId: string, linkId: string, now = new Date()): Promise<void> {
  const result = await db.trackedLink.updateMany({
    where: { id: linkId, workspaceId, archivedAt: null },
    data: { archivedAt: now },
  });
  if (result.count === 0) throw new TrackedLinkError("NOT_FOUND", "追踪链接不存在或已停用");
}
