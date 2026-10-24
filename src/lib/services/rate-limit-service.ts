import { createHash } from "node:crypto";
import { db } from "@/lib/db";

/**
 * 限流原语（与月度套餐额度分开）：按小时 / 按天的计数桶，存在 RateLimitBucket。
 * 只对「用户或访客直接发起」的入口计数——批量内部调用、系统重试不要走这里，
 * 否则一个批次就能把同一用户的单条操作锁住。
 */
export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMIT_EXCEEDED" as const;

  constructor(message = "操作过于频繁，请稍后再试") {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

export function hourlyWindowKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

export function dailyWindowKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function bumpRateLimit(
  bucketKey: string,
  windowKey: string,
  max: number,
  message?: string,
): Promise<void> {
  const row = await db.rateLimitBucket.upsert({
    where: { bucketKey_windowKey: { bucketKey, windowKey } },
    create: { bucketKey, windowKey, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (row.count > max) {
    throw new RateLimitExceededError(message);
  }
}

/**
 * 访客标识的单向哈希：公开表单 / 追踪链接按它限流与去重，库里不存原始 IP。
 */
export function hashVisitorKey(raw: string | null | undefined): string {
  const salt = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "aivora";
  return createHash("sha256")
    .update(`${salt}:${(raw ?? "unknown").trim()}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * 只计数、不判定：返回本窗口累计次数，超了怎么办由调用方决定
 * （例如公开询盘页过了繁忙线只停发邮件、照常收单，不拿 429 误伤真客户）。
 */
export async function countRateLimitHit(bucketKey: string, windowKey: string): Promise<number> {
  const row = await db.rateLimitBucket.upsert({
    where: { bucketKey_windowKey: { bucketKey, windowKey } },
    create: { bucketKey, windowKey, count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET_RE = /^[0-9a-f]{1,4}$/;

function ipv4Octets(value: string): number[] | null {
  const match = IPV4_RE.exec(value);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** 展开 IPv6 为 8 个 16 位段；不合法返回 null。末尾内嵌的 IPv4（::ffff:1.2.3.4）折成两段。 */
function ipv6Hextets(value: string): number[] | null {
  let text = value;
  const embedded = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (embedded) {
    const octets = ipv4Octets(embedded[2]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${embedded[1]}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parts = (half: string | undefined) => (half ? half.split(":") : []);
  const head = parts(halves[0]);
  const tail = parts(halves[1]);
  if (![...head, ...tail].every((hextet) => HEXTET_RE.test(hextet))) return null;
  const missing = 8 - head.length - tail.length;
  /// 有「::」至少省掉一段；没有就必须正好 8 段
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array<string>(missing).fill("0"), ...tail].map((hextet) => parseInt(hextet, 16));
}

/**
 * 访客「网段」：IPv4 取 /24、IPv6 取 /48。公开入口按网段限流——
 * 在同一网段里换地址（一个 IPv6 /64 就有 2^64 个）刷不出新额度。
 * 认不出的写法原样返回（照样进哈希，只是不聚合）；没有 IP 记作 unknown。
 */
export function visitorNetworkKey(ip: string | null | undefined): string {
  let value = (ip ?? "").trim().toLowerCase();
  if (!value) return "unknown";
  /// 去掉 [v6]:port、v4:port 与 v6 的 %zone
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4WithPort) value = v4WithPort[1];
  value = value.replace(/%.*$/, "");

  const v4 = ipv4Octets(value);
  if (v4) return `${v4[0]}.${v4[1]}.${v4[2]}.0/24`;
  const v6 = ipv6Hextets(value);
  if (!v6) return value;
  /// IPv4 映射地址（::ffff:a.b.c.d）按 IPv4 聚合，与直连 IPv4 落到同一个网段
  if (v6.slice(0, 5).every((hextet) => hextet === 0) && v6[5] === 0xffff) {
    return `${v6[6] >> 8}.${v6[6] & 0xff}.${v6[7] >> 8}.0/24`;
  }
  return `${v6.slice(0, 3).map((hextet) => hextet.toString(16)).join(":")}::/48`;
}

/** 公开入口限流用的访客键：先聚合到网段再单向哈希，库里不存原始 IP。 */
export function hashVisitorNetwork(ip: string | null | undefined): string {
  return hashVisitorKey(`net:${visitorNetworkKey(ip)}`);
}
