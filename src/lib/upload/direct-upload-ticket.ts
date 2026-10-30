import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 浏览器直传的「上传票据」：/api/upload/blob/ticket 签发，/api/upload/blob/complete 验收。
 *
 * 直传时文件不经过我们的函数，登记那一步手里只有浏览器报上来的东西。票据把
 * 「谁、传到哪个路径、声明什么类型、何时过期」用 AUTH_SECRET 签死：别人的票据、
 * 伪造的路径、过期的票据一律登记不了，也就不能把任意 Blob 对象认领成自己的资产。
 */
export const DIRECT_UPLOAD_TICKET_TTL_MS = 2 * 60 * 60 * 1000;

export interface DirectUploadTicket {
  userId: string;
  pathname: string;
  contentType: string;
  expiresAt: number;
}

function ticketSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET not configured; cannot sign upload tickets");
  return secret;
}

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`aivora.upload-ticket.v1.${body}`).digest("base64url");
}

export function signDirectUploadTicket(
  ticket: DirectUploadTicket,
  secret: string = ticketSecret(),
): string {
  const body = Buffer.from(
    JSON.stringify({
      u: ticket.userId,
      p: ticket.pathname,
      t: ticket.contentType,
      e: ticket.expiresAt,
    }),
  ).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** 签名不对、不是本人、已过期、字段残缺 → null（调用方统一回「请重新上传」）。 */
export function verifyDirectUploadTicket(
  raw: string,
  expected: { userId: string; now?: number; secret?: string },
): DirectUploadTicket | null {
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;
  const want = Buffer.from(mac(body, expected.secret ?? ticketSecret()));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object") return null;
  const { u, p, t, e } = decoded as Record<string, unknown>;
  if (typeof u !== "string" || typeof p !== "string" || typeof t !== "string") return null;
  if (typeof e !== "number" || !Number.isFinite(e)) return null;
  if (u !== expected.userId) return null;
  if (e < (expected.now ?? Date.now())) return null;
  if (!p.startsWith("uploads/")) return null;
  return { userId: u, pathname: p, contentType: t, expiresAt: e };
}
