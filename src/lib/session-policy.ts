/**
 * 会话安全策略（10-30 CEO 反馈：两天前的登录还在，点开 /app/create 直接进，没输密码）。
 *
 * 三道闸，middleware（edge）与 NextAuth jwt 回调（node）用同一份纯函数判定：
 * 1. 闲置超时：SESSION_IDLE_MAX_AGE_SECONDS 内没有活动就过期（NextAuth maxAge 滚动续期，
 *    token 的 exp 由它管，getToken 已经判过）。
 * 2. 绝对上限：不管多活跃，登录满 SESSION_ABSOLUTE_MAX_AGE_SECONDS 必须重新输密码。
 * 3. 发布即失效：token 记下登录时的发布版本，生产每发一版，之前签发的登录全部作废。
 *
 * 发布版本由 next.config 的 env 在构建时内联（AIVORA_SESSION_RELEASE = 当次部署的 git commit），
 * edge 与 node 拿到的是同一个常量。若两边各读运行时环境变量，一边有值一边没值，就会把
 * 刚登录的人也判成旧版本，所有人锁死在登录页。本地构建没有 commit → 不按发布失效。
 *
 * 本文件不能 import 任何 node 专属模块：middleware 跑在 edge。
 */

export const SESSION_IDLE_MAX_AGE_SECONDS = 12 * 60 * 60;
export const SESSION_ABSOLUTE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** ok：放行；expired：超过绝对上限；superseded：不是本次发布签发（含本策略上线前的旧 token）。 */
export type SessionClaimsVerdict = "ok" | "expired" | "superseded";

/** NextAuth 的 JWT（middleware 的 getToken 与 jwt 回调里的 token）；只读 loginAt / release 两项。 */
export type SessionClaims = Readonly<Record<string, unknown>>;

export function currentSessionRelease(): string | null {
  const release = process.env.AIVORA_SESSION_RELEASE?.trim();
  return release ? release : null;
}

/** 新登录写进 token 的声明：登录时刻（秒）与签发时的发布版本。 */
export function newSessionClaims(nowMs: number = Date.now()): { loginAt: number; release: string | null } {
  return { loginAt: Math.floor(nowMs / 1000), release: currentSessionRelease() };
}

export function evaluateSessionClaims(
  claims: SessionClaims | null | undefined,
  options: { nowMs?: number; release?: string | null } = {},
): SessionClaimsVerdict {
  const loginAt = claims?.loginAt;
  /// 没有登录时刻 = 本策略上线前签发的 token：当作旧版本的登录，重新登录一次。
  if (typeof loginAt !== "number" || !Number.isFinite(loginAt)) return "superseded";
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (nowSeconds - loginAt > SESSION_ABSOLUTE_MAX_AGE_SECONDS) return "expired";
  const release = options.release === undefined ? currentSessionRelease() : options.release;
  if (release && claims?.release !== release) return "superseded";
  return "ok";
}
