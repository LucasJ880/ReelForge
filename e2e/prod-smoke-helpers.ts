/**
 * 发布后冒烟（e2e/prod-smoke.spec.ts）里不碰浏览器的那部分：发布版本核对、对比度、
 * 跨部署交接的会话文件。只依赖 node 内置模块，tests/prod-smoke-helpers.test.ts 直接单测。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** 闲置超时：与 src/lib/session-policy.ts 的 SESSION_IDLE_MAX_AGE_SECONDS 一致（12 小时）。 */
export const SESSION_IDLE_MAX_AGE_SECONDS = 12 * 60 * 60;

/** NextAuth 会话 cookie：生产带 __Secure- 前缀，超过 4KB 会分片成 .0 / .1。 */
export const SESSION_COOKIE_NAME = /^(__Secure-)?next-auth\.session-token(\.\d+)?$/;

/// 手机原图：Vercel 函数请求体上限 4.5MB，文件要明显超过它才测得出「一穿过函数就 413」。
export const PHONE_PHOTO_WIDTH = 3024;
export const PHONE_PHOTO_HEIGHT = 4032;
export const PHONE_PHOTO_MIN_BYTES = 6 * 1024 * 1024;

/** WCAG AA 正文对比度。 */
export const MIN_TEXT_CONTRAST = 4.5;

const RELEASE_PATTERN = /^[0-9a-f]{7,40}$/;

// ---------------------------------------------------------------------------
// 发布版本：生产别名是否已经切到这次部署
// ---------------------------------------------------------------------------

export type LiveReleaseCheck =
  | { kind: "match"; live: string }
  /// 别名还挂在别的部署上（刚发布、还没切过来，或这次生产部署没被提升）
  | { kind: "other"; live: string }
  /// /api/health 没报 release（老部署，或运行时拿不到 VERCEL_GIT_COMMIT_SHA）：核对不了
  | { kind: "unknown" };

/** 读 GET /api/health 的 release，与工作流传进来的部署 commit 比。 */
export function checkLiveRelease(health: unknown, expected: string): LiveReleaseCheck {
  const live = readRelease(health);
  if (!live) return { kind: "unknown" };
  return live === expected.trim().toLowerCase() ? { kind: "match", live } : { kind: "other", live };
}

export function readRelease(health: unknown): string | null {
  if (!health || typeof health !== "object") return null;
  const release = (health as { release?: unknown }).release;
  return typeof release === "string" && RELEASE_PATTERN.test(release) ? release : null;
}

// ---------------------------------------------------------------------------
// 上传走到哪了
// ---------------------------------------------------------------------------

export interface UploadCall {
  method: string;
  path: string;
  status: number;
}

/** 冒烟期间同源的 /api/upload/* 往来与页面新冒出来的报错 → 结论；"pending" 表示还没有结论。 */
export function classifyUploadOutcome(calls: readonly UploadCall[], newAlerts: readonly string[]): string {
  /// 10-30：客户端把文件 multipart 发给函数，Vercel 在函数之前就回 413
  if (calls.some((call) => call.path === "/api/upload/blob")) return "退回了旧的 multipart 中转";
  const ticket = calls.find((call) => call.path === "/api/upload/blob/ticket");
  if (ticket && ticket.status !== 200) return `ticket ${ticket.status}`;
  const complete = calls.find((call) => call.path === "/api/upload/blob/complete");
  if (complete) return complete.status === 201 ? "registered" : `complete ${complete.status}`;
  /// 直传 Blob 那一步失败时没有同源请求可看，只有页面上的报错
  if (newAlerts.length > 0) return `页面报错：${newAlerts.join(" / ")}`;
  return "pending";
}

// ---------------------------------------------------------------------------
// 原生下拉选项的颜色
// ---------------------------------------------------------------------------

/** r / g / b 为 0–255，a 为 0–1。 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface OptionColors {
  label: string;
  /** getComputedStyle 原样的字色 / 底色，只用于报错时给人看 */
  cssColor: string;
  cssBackground: string;
  /** 浏览器换算成 sRGB 后的值（页面里用 canvas 换算，oklch / color() 也能比） */
  color: Rgba;
  background: Rgba;
}

/** WCAG 2.x 相对亮度。 */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** 字色对底色的对比度；半透明字色先叠到底色上再算。 */
export function contrastRatio(text: Rgba, background: Rgba): number {
  const alpha = Math.min(1, Math.max(0, text.a));
  const shown: Rgba = {
    r: text.r * alpha + background.r * (1 - alpha),
    g: text.g * alpha + background.g * (1 - alpha),
    b: text.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
  const [lighter, darker] = [relativeLuminance(shown), relativeLuminance(background)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 一个选项读不读得清。原生弹层由浏览器画：选项没有自己的底色时，Windows / Linux 的 Chrome、
 * Edge 与 Firefox 会画成默认白底，字色却继承页面的浅色——10-30 的「创意模板白底看不到字」。
 * 所以底色必须不透明，且对比度 ≥ 4.5:1。没问题返回 null。
 */
export function optionColorProblem(option: OptionColors): string | null {
  if (option.background.a < 0.99) {
    return `底色透明（${option.cssBackground}），原生弹层会退回浏览器默认白底`;
  }
  const ratio = contrastRatio(option.color, option.background);
  if (ratio < MIN_TEXT_CONTRAST) {
    return `对比度 ${ratio.toFixed(2)}:1 低于 ${MIN_TEXT_CONTRAST}:1（字 ${option.cssColor} / 底 ${option.cssBackground}）`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 跨部署交接的会话：这一轮签的登录，下一次部署后必须被拒（发布即失效）
// ---------------------------------------------------------------------------

export interface SmokeCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface SmokeSession {
  version: 1;
  baseURL: string;
  /** 签发这份会话时生产在跑的 commit；不知道就是 null */
  release: string | null;
  savedAt: string;
  /** 只存 NextAuth 会话 cookie，别的一概不带 */
  cookies: SmokeCookie[];
}

/// 文件只给当前用户读：工作流随后用 QA 账号密码加密它，明文不进 artifact。
export function saveSmokeSession(path: string, session: SmokeSession): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
}

/** 文件不存在、解不开、形状不对一律 null（调用方据此跳过，不报错）。 */
export function loadSmokeSession(path: string): SmokeSession | null {
  try {
    return parseSmokeSession(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function parseSmokeSession(raw: string): SmokeSession | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<SmokeSession>;
  if (session.version !== 1) return null;
  if (typeof session.baseURL !== "string" || typeof session.savedAt !== "string") return null;
  if (!Number.isFinite(Date.parse(session.savedAt))) return null;
  if (session.release !== null && (typeof session.release !== "string" || !RELEASE_PATTERN.test(session.release))) {
    return null;
  }
  if (!Array.isArray(session.cookies)) return null;
  const cookies = session.cookies.filter(isSessionCookie);
  if (cookies.length === 0) return null;
  return { version: 1, baseURL: session.baseURL, release: session.release, savedAt: session.savedAt, cookies };
}

function isSessionCookie(cookie: unknown): cookie is SmokeCookie {
  if (!cookie || typeof cookie !== "object") return false;
  const c = cookie as Partial<SmokeCookie>;
  return typeof c.name === "string"
    && SESSION_COOKIE_NAME.test(c.name)
    && typeof c.value === "string"
    && typeof c.domain === "string"
    && typeof c.path === "string"
    && typeof c.expires === "number"
    && typeof c.httpOnly === "boolean"
    && typeof c.secure === "boolean"
    && (c.sameSite === "Strict" || c.sameSite === "Lax" || c.sameSite === "None");
}

export type StaleSessionPlan =
  | { kind: "skip"; reason: string }
  /// expired：中间件按会话策略拒（跳 /login?reason=expired）；超过闲置时长的 token 自己就过期了，
  /// 中间件当作没登录，跳 /login 不带 reason——两种都算「被拒」，只有前者能证明是发布即失效生效。
  | { kind: "expect-rejected"; reasonExpired: boolean };

export function planStaleSessionCheck(
  previous: SmokeSession,
  current: { baseURL: string; release: string | null; nowMs: number },
): StaleSessionPlan {
  if (previous.baseURL !== current.baseURL) {
    return { kind: "skip", reason: `上一轮测的是 ${previous.baseURL}，不是 ${current.baseURL}` };
  }
  if (!current.release || !previous.release) {
    return { kind: "skip", reason: "拿不到两次部署的 commit，判断不了是否换了版本" };
  }
  if (previous.release === current.release) {
    return { kind: "skip", reason: `同一个 commit（${current.release.slice(0, 7)}）重新部署：发布即失效按 commit 判，旧会话本来就该有效` };
  }
  const ageSeconds = (current.nowMs - Date.parse(previous.savedAt)) / 1000;
  /// 留 10 分钟余量：贴着闲置上限的会话，说不清是哪道闸先拒的
  return { kind: "expect-rejected", reasonExpired: ageSeconds < SESSION_IDLE_MAX_AGE_SECONDS - 600 };
}
