/**
 * 运维告警通道（2026-11-09 稳定性体检）。
 *
 * 体检时的事实：10 月 OpenAI 欠费，帧质检 20/24 条静默跳过；两条任务在供应商侧挂了 5 小时；
 * 11-08 的迁移没执行——全都没有任何人被通知。邮件没配（创始人日报只进日志），仓库里也没有错误追踪。
 * 这里补一条最小的「出事有人被叫醒」通道：
 *
 *  - 发到 OPS_ALERT_WEBHOOK_URL（飞书 / 企业微信 / 钉钉 / Slack 的群机器人，或任意收 JSON 的地址）；
 *    按域名选报文形状，认不出的域名发通用 JSON；
 *  - 去重复用 RateLimitBucket（与创始人日报同一个闩锁做法，不加表）：同一个 dedupeKey 在一个窗口
 *    （默认一小时，可选一天）里只发第一条；
 *  - 没配地址：照样去重，然后把告警打进错误日志（至少 Vercel 日志里搜得到 `[ops-alert]`）；
 *  - 只在线上 Next 服务端发（与能力状态回写同一口径）：单测子进程、本地 `next dev`（.env.local 直连生产库）
 *    只打日志、不碰库、不外发。OPS_ALERT_FORCE=1 给脚本用；
 *  - 永不抛出、单次外发 5 秒超时：告警失败不能拖垮它所在的 cron / 请求。
 *
 * 报文纪律：只写任务号、状态、计数与供应商报错摘要；不写客户姓名、邮箱、素材地址。
 * 调用方给的每一行都会截断并抹掉形似密钥的片段。
 *
 * 刻意不静态 import `@/lib/db` / rate-limit-service：capability-status-service 会懒加载本模块，
 * 而它被每个 provider import——数据库客户端只在真要占闩锁时才加载。
 */

export const OPS_ALERT_KINDS = [
  "capability_down",
  "capability_recovered",
  "frame_qa_unverified",
  "job_kept_alive",
  "stitch_failed",
  "submit_ack_unknown",
  "cron_overrun",
  "provider_low_balance",
] as const;
export type OpsAlertKind = (typeof OPS_ALERT_KINDS)[number];

export interface OpsAlert {
  kind: OpsAlertKind;
  /** 去重键：同一个键在一个窗口里只发第一条 */
  dedupeKey: string;
  /** 去重窗口，默认一小时；按任务去重的告警用一天，免得同一条任务每小时响一次 */
  window?: "hour" | "day";
  title: string;
  lines?: string[];
}

export type OpsAlertOutcome = "sent" | "logged" | "duplicate" | "disabled" | "failed";

export interface OpsAlertResult {
  outcome: OpsAlertOutcome;
  /** 外发失败时的简短原因（HTTP 状态或错误名），不含报文 */
  detail?: string;
}

export interface OpsAlertDeps {
  enabled: () => boolean;
  webhookUrl: () => string | null;
  /** 占去重闩锁：true = 本窗口第一条。抛错视为「占到了」（宁可重复，不可漏报） */
  claim: (bucketKey: string, windowKey: string) => Promise<boolean>;
  post: (url: string, body: unknown) => Promise<{ ok: boolean; status: number }>;
  now: () => Date;
  log: (message: string) => void;
}

const POST_TIMEOUT_MS = 5_000;
const MAX_LINE_CHARS = 300;
const MAX_LINES = 8;
const MAX_TEXT_CHARS = 1_500;
export const OPS_ALERT_BUCKET_PREFIX = "ops-alert:";

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** 只认 https 地址；写错（http、缺协议、不是 URL）一律当没配，不把告警发到明文地址。 */
export function opsAlertWebhookUrl(env: EnvLike = process.env): string | null {
  const raw = env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 外发开关：线上 Next 服务端（NEXT_RUNTIME=nodejs 且 NODE_ENV=production）或显式 OPS_ALERT_FORCE=1。
 * node:test 子进程永远不发；OPS_ALERT_FORCE=0 是总闸。
 */
export function isOpsAlertEnabled(env: EnvLike = process.env): boolean {
  if (env.OPS_ALERT_FORCE === "0") return false;
  if (env.NODE_TEST_CONTEXT) return false;
  if (env.OPS_ALERT_FORCE === "1") return true;
  return env.NEXT_RUNTIME === "nodejs" && env.NODE_ENV === "production";
}

const SECRET_LIKE = /\b(?:sk|rk|pk|key|tok)[-_][A-Za-z0-9_-]{12,}\b|Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g;
const URL_QUERY = /(https?:\/\/[^\s?#]+)\?[^\s]*/g;

/** 抹掉形似密钥的片段与 URL 的查询串（签名、token 常在那儿），再截断。 */
export function scrubAlertLine(line: string): string {
  return line
    .replace(SECRET_LIKE, "[已隐去]")
    .replace(URL_QUERY, "$1?…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LINE_CHARS);
}

export function opsAlertText(alert: OpsAlert): string {
  const lines = (alert.lines ?? []).map(scrubAlertLine).filter(Boolean).slice(0, MAX_LINES);
  return [`【Aivora 运维】${scrubAlertLine(alert.title)}`, ...lines].join("\n").slice(0, MAX_TEXT_CHARS);
}

/** 按机器人所在域名选报文形状；认不出的发通用 JSON（text + kind + lines）。 */
export function opsAlertRequestBody(webhookUrl: string, alert: OpsAlert): Record<string, unknown> {
  const text = opsAlertText(alert);
  let host = "";
  try {
    host = new URL(webhookUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host.endsWith("feishu.cn") || host.endsWith("larksuite.com")) {
    return { msg_type: "text", content: { text } };
  }
  if (host.endsWith("weixin.qq.com") || host.endsWith("dingtalk.com")) {
    return { msgtype: "text", text: { content: text } };
  }
  if (host.endsWith("slack.com") || host.endsWith("discord.com")) {
    return host.endsWith("discord.com") ? { content: text } : { text };
  }
  return { text, kind: alert.kind, title: scrubAlertLine(alert.title), lines: (alert.lines ?? []).map(scrubAlertLine) };
}

export function opsAlertWindowKey(window: "hour" | "day", now: Date): string {
  const iso = now.toISOString();
  return window === "day" ? iso.slice(0, 10) : iso.slice(0, 13);
}

async function claimInDb(bucketKey: string, windowKey: string): Promise<boolean> {
  const { countRateLimitHit } = await import("@/lib/services/rate-limit-service");
  return (await countRateLimitHit(bucketKey, windowKey)) === 1;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  return { ok: response.ok, status: response.status };
}

const defaultDeps: OpsAlertDeps = {
  enabled: () => isOpsAlertEnabled(),
  webhookUrl: () => opsAlertWebhookUrl(),
  claim: claimInDb,
  post: postJson,
  now: () => new Date(),
  log: (message) => console.error(message),
};

/**
 * 发一条运维告警。永不抛出。
 *  - disabled：当前环境不外发（单测 / 本地），只打日志；
 *  - duplicate：本窗口已发过同一个 dedupeKey；
 *  - logged：没配 webhook，已写进错误日志；
 *  - sent / failed：外发结果（失败同样写日志，不重试——下个窗口还会再报）。
 */
export async function sendOpsAlert(alert: OpsAlert, overrides: Partial<OpsAlertDeps> = {}): Promise<OpsAlertResult> {
  const deps = { ...defaultDeps, ...overrides };
  try {
    const text = opsAlertText(alert);
    if (!deps.enabled()) {
      deps.log(`[ops-alert] (未外发：非线上环境) ${alert.kind} ${text.replace(/\n/g, " | ")}`);
      return { outcome: "disabled" };
    }
    const bucketKey = `${OPS_ALERT_BUCKET_PREFIX}${alert.dedupeKey}`.slice(0, 180);
    const windowKey = opsAlertWindowKey(alert.window ?? "hour", deps.now());
    const first = await deps.claim(bucketKey, windowKey).catch(() => true);
    if (!first) return { outcome: "duplicate" };

    const url = deps.webhookUrl();
    if (!url) {
      deps.log(`[ops-alert] (未配置 OPS_ALERT_WEBHOOK_URL) ${alert.kind} ${text.replace(/\n/g, " | ")}`);
      return { outcome: "logged" };
    }
    const response = await deps.post(url, opsAlertRequestBody(url, alert));
    if (!response.ok) {
      deps.log(`[ops-alert] 外发失败 HTTP ${response.status}：${alert.kind} ${text.replace(/\n/g, " | ")}`);
      return { outcome: "failed", detail: `http_${response.status}` };
    }
    return { outcome: "sent" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    try {
      deps.log(`[ops-alert] 外发异常 ${name}：${alert.kind} ${scrubAlertLine(alert.title)}`);
    } catch {
      /// 连日志都写不了也不能抛
    }
    return { outcome: "failed", detail: name };
  }
}

/* ── 各挂接点的报文（纯函数，便于单测口径） ─────────────────────────── */

const CAPABILITY_LABELS: Record<string, string> = {
  text: "写作（文本模型）",
  vision: "看图（帧质检 / 出方案看商品图）",
  image: "出图",
  graphics: "图文",
  video: "出片",
  voice: "配音",
  moderation: "内容审核",
  stock: "素材图库",
  scrape: "链接抓取",
  cutout: "抠图",
  email: "邮件",
};

const DOWN_STATUSES = new Set(["unavailable", "degraded"]);

/**
 * 能力状态翻转 → 告警。只报「正常 → 暂停/不稳」与「暂停/不稳 → 正常」；
 * not_configured 是配置问题不是事故，不报；同状态刷新不报。
 */
export function capabilityTransitionAlert(
  prev: { status: string } | null | undefined,
  next: { key: string; status: string; reason: string; detail?: { provider?: string; note?: string; httpStatus?: number } },
): OpsAlert | null {
  const wasDown = prev ? DOWN_STATUSES.has(prev.status) : false;
  const isDown = DOWN_STATUSES.has(next.status);
  const label = CAPABILITY_LABELS[next.key] ?? next.key;
  if (isDown && (!prev || prev.status !== next.status)) {
    return {
      kind: "capability_down",
      dedupeKey: `capability:${next.key}:${next.status}`,
      title: `${label}${next.status === "unavailable" ? "已暂停" : "不稳定"}`,
      lines: [
        `原因：${next.reason}${next.detail?.httpStatus ? `（HTTP ${next.detail.httpStatus}）` : ""}`,
        ...(next.detail?.provider ? [`供应商：${next.detail.provider}`] : []),
        ...(next.detail?.note ? [`备注：${next.detail.note}`] : []),
        ...(next.key === "vision" ? ["影响：帧质检会没检成，成片标「未质检」直接交付"] : []),
      ],
    };
  }
  if (wasDown && next.status === "available") {
    return {
      kind: "capability_recovered",
      dedupeKey: `capability:${next.key}:recovered`,
      title: `${label}已恢复`,
    };
  }
  return null;
}

/**
 * Shuyu 余额预警：还够出几条 15 秒视频。能力状态要等余额不够 1 条才翻成「暂停」，那时已经断供；
 * 这里提前在「还剩不到 N 条」时提醒充值（默认 20 条，OPS_ALERT_SHUYU_MIN_VIDEOS 可调，0 = 关）。
 * 按天去重：没充值就每天提醒一次。
 */
export const DEFAULT_SHUYU_MIN_VIDEOS = 20;

export function shuyuMinVideosThreshold(env: EnvLike = process.env): number {
  const raw = env.OPS_ALERT_SHUYU_MIN_VIDEOS?.trim();
  if (!raw) return DEFAULT_SHUYU_MIN_VIDEOS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_SHUYU_MIN_VIDEOS;
}

export function shuyuLowBalanceAlert(args: {
  balancePoints: number | null;
  videoCostPoints: number | null;
  minVideos: number;
}): OpsAlert | null {
  const { balancePoints, videoCostPoints, minVideos } = args;
  if (balancePoints === null || videoCostPoints === null || videoCostPoints <= 0 || minVideos <= 0) return null;
  const videosLeft = Math.floor(balancePoints / videoCostPoints);
  if (videosLeft >= minVideos) return null;
  return {
    kind: "provider_low_balance",
    dedupeKey: "provider-low-balance:shuyu",
    window: "day",
    title: `Shuyu 余额只够约 ${videosLeft} 条 15 秒视频了`,
    lines: [
      `余额 ${balancePoints} 积分；最便宜的 15 秒档 ${videoCostPoints} 积分/条`,
      `预警线：少于 ${minVideos} 条。余额不够 1 条时出片会直接暂停`,
    ],
  };
}
