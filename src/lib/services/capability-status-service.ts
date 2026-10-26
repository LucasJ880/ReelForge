import {
  CAPABILITY_KEYS,
  isCapabilityKey,
  isCapabilityReason,
  isCapabilityStatus,
  nextCapabilityRecord,
  resolveCapabilities,
  type CapabilityDetail,
  type CapabilityKey,
  type CapabilityObservation,
  type CapabilityProviders,
  type CapabilityRecord,
  type CapabilitySource,
  type PublicCapabilities,
} from "@/lib/capabilities/registry";
import { classifyRuntimeFailure } from "@/lib/capabilities/classify";
import { isTtsConfigured, resolveTtsProviderId } from "@/lib/providers/tts/config";

/**
 * C4 · 能力状态的读写（服务端）。
 *
 *  - getCapabilities()：读 CapabilityStatus 表 + 运行时配置 → 客户视图，进程内缓存 60 秒；
 *    读失败（表还没建、库抖动）退回「按配置显示」，绝不抛给页面——状态表出问题不能变成拦客户的理由。
 *  - markCapability(key, outcome)：生产调用成功 / 撞上账户层错误时立即回写。同状态 10 分钟内只写一次，
 *    任何失败只记日志、绝不抛出（不能让状态回写拖垮客户请求）。
 *
 * 刻意不静态 import `@/lib/db`：provider 模块（openai / tts / 图库 …）都会 import 本模块，
 * 用到时才懒加载 Prisma，免得把数据库客户端塞进每一个 provider 的模块图。
 */

export const CAPABILITY_CACHE_TTL_MS = 60_000;
/** 同一状态的生产回写节流：10 分钟内重复的「成功」不再写库。 */
export const CAPABILITY_RUNTIME_REFRESH_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 2_500;
const WRITE_TIMEOUT_MS = 2_500;

export interface CapabilityStore {
  readAll(): Promise<CapabilityRecord[]>;
  read(key: CapabilityKey): Promise<CapabilityRecord | null>;
  write(record: CapabilityRecord): Promise<void>;
}

/* ── 行 ↔ 领域记录 ─────────────────────────────────────────────────── */

type CapabilityRow = {
  key: string;
  status: string;
  detail: unknown;
  checkedAt: Date;
  failingSince: Date | null;
};

const DETAIL_FIELDS = ["provider", "httpStatus", "model", "note", "ttsProbedAt", "balancePoints"] as const;
const SOURCES: ReadonlySet<CapabilitySource> = new Set(["probe", "runtime", "derived", "config"]);

function pickDetail(raw: Record<string, unknown>): CapabilityDetail | undefined {
  const detail: CapabilityDetail = {};
  if (typeof raw.provider === "string") detail.provider = raw.provider.slice(0, 40);
  if (typeof raw.httpStatus === "number") detail.httpStatus = raw.httpStatus;
  if (typeof raw.model === "string") detail.model = raw.model.slice(0, 80);
  if (typeof raw.note === "string") detail.note = raw.note.slice(0, 160);
  if (typeof raw.ttsProbedAt === "string") detail.ttsProbedAt = raw.ttsProbedAt;
  if (typeof raw.balancePoints === "number") detail.balancePoints = raw.balancePoints;
  return Object.keys(detail).length > 0 ? detail : undefined;
}

export function rowToCapabilityRecord(row: CapabilityRow): CapabilityRecord | null {
  if (!isCapabilityKey(row.key) || !isCapabilityStatus(row.status)) return null;
  const raw = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
    ? (row.detail as Record<string, unknown>)
    : {};
  const reason = isCapabilityReason(raw.reason) ? raw.reason : row.status === "available" ? "ok" : "unknown";
  const source = typeof raw.source === "string" && SOURCES.has(raw.source as CapabilitySource)
    ? (raw.source as CapabilitySource)
    : "probe";
  const detail = pickDetail(raw);
  return {
    key: row.key,
    status: row.status,
    reason,
    source,
    checkedAt: row.checkedAt.toISOString(),
    failingSince: row.failingSince ? row.failingSince.toISOString() : null,
    ...(detail ? { detail } : {}),
  };
}

export function capabilityRecordToRow(record: CapabilityRecord): {
  status: string;
  detail: Record<string, unknown>;
  checkedAt: Date;
  failingSince: Date | null;
} {
  const detail: Record<string, unknown> = { reason: record.reason, source: record.source };
  for (const field of DETAIL_FIELDS) {
    const value = record.detail?.[field];
    if (value !== undefined) detail[field] = value;
  }
  return {
    status: record.status,
    detail,
    checkedAt: new Date(record.checkedAt),
    failingSince: record.failingSince ? new Date(record.failingSince) : null,
  };
}

/* ── 存储 ───────────────────────────────────────────────────────────── */

async function prismaDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export const prismaCapabilityStore: CapabilityStore = {
  async readAll() {
    const db = await prismaDb();
    const rows = await db.capabilityStatus.findMany();
    return rows.map(rowToCapabilityRecord).filter((record): record is CapabilityRecord => record !== null);
  },
  async read(key) {
    const db = await prismaDb();
    const row = await db.capabilityStatus.findUnique({ where: { key } });
    return row ? rowToCapabilityRecord(row) : null;
  },
  async write(record) {
    const db = await prismaDb();
    const row = capabilityRecordToRow(record);
    await db.capabilityStatus.upsert({
      where: { key: record.key },
      create: { key: record.key, ...row, detail: row.detail as object },
      update: { ...row, detail: row.detail as object },
    });
  },
};

/** 没有数据库（测试、无 DATABASE_URL 的脚本）时的空存储：读空、写丢弃。 */
const nullCapabilityStore: CapabilityStore = {
  async readAll() {
    return [];
  },
  async read() {
    return null;
  },
  async write() {},
};

/** 测试与脚本用的内存存储。 */
export function createMemoryCapabilityStore(initial: CapabilityRecord[] = []): CapabilityStore & {
  records: Map<CapabilityKey, CapabilityRecord>;
  writes: CapabilityRecord[];
} {
  const records = new Map<CapabilityKey, CapabilityRecord>(initial.map((record) => [record.key, record]));
  const writes: CapabilityRecord[] = [];
  return {
    records,
    writes,
    async readAll() {
      return [...records.values()];
    },
    async read(key) {
      return records.get(key) ?? null;
    },
    async write(record) {
      writes.push(record);
      records.set(record.key, record);
    },
  };
}

let storeOverride: CapabilityStore | null = null;

/** 仅测试：注入存储（同时打开生产回写）。传 null 还原。 */
export function __setCapabilityStoreForTests(store: CapabilityStore | null): void {
  storeOverride = store;
  cache = null;
  lastRuntimeWrite.clear();
  inflight.clear();
}

/** 读用：有库就读库。 */
export function defaultCapabilityStore(): CapabilityStore {
  if (storeOverride) return storeOverride;
  return process.env.DATABASE_URL ? prismaCapabilityStore : nullCapabilityStore;
}

/**
 * 生产回写的开关。只在线上 Next 服务端（构建时把 NEXT_RUNTIME 定成 nodejs，且 NODE_ENV=production）
 * 或显式 CAPABILITY_WRITE_THROUGH=1 的脚本里写库：
 *  - node:test 子进程（NODE_TEST_CONTEXT）永远不写——单测里打桩的 429 / 成功绝不能写进生产状态表；
 *  - 本地 `next dev` 不写——.env.local 直连生产库，本机换了 key 的观测不代表线上。
 * CAPABILITY_WRITE_THROUGH=0 是总闸。
 */
export function isCapabilityWriteThroughEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): boolean {
  if (storeOverride) return true;
  if (env.CAPABILITY_WRITE_THROUGH === "0") return false;
  if (env.NODE_TEST_CONTEXT) return false;
  if (!env.DATABASE_URL) return false;
  if (env.CAPABILITY_WRITE_THROUGH === "1") return true;
  return process.env.NEXT_RUNTIME === "nodejs" && env.NODE_ENV === "production";
}

/* ── 配置 ───────────────────────────────────────────────────────────── */

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

function has(env: EnvLike, name: string): boolean {
  return Boolean(env[name]?.trim());
}

function hasList(env: EnvLike, name: string): boolean {
  return (env[name] ?? "").split(",").some((part) => part.trim().length > 0);
}

/**
 * 每个能力的配置是否齐全（只看 env，不发请求）。与各 provider 的 isXxxAvailable() 同一判据，
 * 但在这里重写一遍而不 import provider：provider 反过来要 import 本模块做回写，不能成环。
 */
export function capabilityConfiguration(env: EnvLike = process.env): Record<CapabilityKey, boolean> {
  const openai = has(env, "OPENAI_API_KEY");
  const volcengine = env.AI_PROVIDER?.trim() === "volcengine";
  const chat = volcengine ? has(env, "VOLCENGINE_ARK_API_KEY") || has(env, "ARK_API_KEY") : openai;
  const shuyu = has(env, "SHUYU_API_KEY") || has(env, "shuyu_api_key");
  return {
    text: chat,
    vision: chat,
    image: shuyu,
    graphics: chat && env.IMAGE_ENGINE_MOCK !== "true",
    video: shuyu,
    voice: isTtsConfigured(env),
    moderation: openai,
    stock: hasList(env, "PEXELS_API_KEYS") || hasList(env, "PIXABAY_API_KEYS"),
    scrape: has(env, "FIRECRAWL_API_KEY"),
    cutout: has(env, "REMOVE_BG_API_KEY") || has(env, "CLIPDROP_API_KEY"),
    email: has(env, "RESEND_API_KEY") && has(env, "EMAIL_FROM"),
  };
}

/** 能力背后可切换的供应商（目前只有配音）：决定它是否跟着 OpenAI 账户一起停。 */
export function capabilityProviders(env: EnvLike = process.env): CapabilityProviders {
  return { voice: resolveTtsProviderId(env) };
}

/* ── 进程内缓存 ─────────────────────────────────────────────────────── */

type Cache = { loadedAt: number; records: Map<CapabilityKey, CapabilityRecord> };
let cache: Cache | null = null;
const lastRuntimeWrite = new Map<CapabilityKey, number>();
const inflight = new Map<CapabilityKey, { observation: CapabilityObservation; promise: Promise<void> }>();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function cachedRecords(): Map<CapabilityKey, CapabilityRecord> {
  if (!cache) cache = { loadedAt: 0, records: new Map() };
  return cache.records;
}

/**
 * 写入后同步更新本实例缓存（其它实例 60 秒内读库追上）。只合并、不刷新 loadedAt：
 * 冷实例的缓存里只有刚写的几条，下一次读仍要回库拿全量。
 */
export function rememberCapabilityRecords(records: CapabilityRecord[]): void {
  const map = cachedRecords();
  for (const record of records) map.set(record.key, record);
}

/** 仅测试：清缓存与节流状态。 */
export function __resetCapabilityCacheForTests(): void {
  cache = null;
  lastRuntimeWrite.clear();
  inflight.clear();
}

async function loadRecords(options: { now: Date; store: CapabilityStore; fresh: boolean }): Promise<CapabilityRecord[]> {
  if (!options.fresh && cache && cache.loadedAt > 0 && options.now.getTime() - cache.loadedAt < CAPABILITY_CACHE_TTL_MS) {
    return [...cache.records.values()];
  }
  try {
    const rows = await withTimeout(options.store.readAll(), READ_TIMEOUT_MS, "capability read");
    cache = { loadedAt: options.now.getTime(), records: new Map(rows.map((record) => [record.key, record])) };
  } catch (error) {
    /// 表还没迁移 / 库抖动：保留上一份（没有就空），60 秒内不再重试，免得每个页面都打一次失败的查询。
    console.warn("[capabilities] 读取能力状态失败，按配置显示：", (error as Error).message);
    cache = { loadedAt: options.now.getTime(), records: cache?.records ?? new Map() };
  }
  return [...cache.records.values()];
}

/**
 * 客户视图（壳层、创作页、本周内容、状态页、GET /api/capabilities 共用）。永不抛出。
 */
export async function getCapabilities(
  options: { now?: Date; env?: EnvLike; store?: CapabilityStore; fresh?: boolean } = {},
): Promise<PublicCapabilities> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  let records: CapabilityRecord[] = [];
  try {
    records = await loadRecords({ now, store: options.store ?? defaultCapabilityStore(), fresh: options.fresh ?? false });
  } catch {
    records = [];
  }
  return resolveCapabilities({
    records,
    configured: capabilityConfiguration(env),
    providers: capabilityProviders(env),
    now,
  });
}

/* ── 生产回写 ───────────────────────────────────────────────────────── */

export type CapabilityOutcome = "success" | { error: unknown };

function sameState(a: Pick<CapabilityObservation, "status" | "reason"> | undefined, b: CapabilityObservation): boolean {
  return Boolean(a && a.status === b.status && a.reason === b.reason);
}

async function writeRuntime(
  key: CapabilityKey,
  observation: CapabilityObservation,
  now: Date,
  store: CapabilityStore,
): Promise<void> {
  const known = cachedRecords().get(key);
  let prev: CapabilityRecord | null = known ?? null;
  if (!prev && observation.status !== "available") {
    /// 失败时要沿用原 failingSince，冷实例先读一次库（失败很少见，这次读不贵）。
    prev = await withTimeout(store.read(key), READ_TIMEOUT_MS, "capability read").catch(() => null);
  }
  const next = nextCapabilityRecord(prev, key, observation, now, "runtime");
  await withTimeout(store.write(next), WRITE_TIMEOUT_MS, "capability write");
  cachedRecords().set(key, next);
  lastRuntimeWrite.set(key, now.getTime());
}

/**
 * 生产调用的结果实时回写到能力状态。
 *  - "success" → 正常（清 failingSince）
 *  - { error } → 只有账户层错误（额度 / 欠费 / key / 模型权限）才回写为暂停；超时与 5xx 不改状态
 * 同一状态 10 分钟内只写一次；永不抛出。
 */
export async function markCapability(
  key: CapabilityKey,
  outcome: CapabilityOutcome,
  options: { now?: Date; detail?: CapabilityDetail } = {},
): Promise<void> {
  try {
    if (!isCapabilityWriteThroughEnabled()) return;
    const classified: CapabilityObservation | null = outcome === "success"
      ? { status: "available", reason: "ok" }
      : classifyRuntimeFailure(outcome.error);
    if (!classified) return;
    const observation: CapabilityObservation = {
      ...classified,
      detail: { ...(options.detail ?? {}), ...(classified.detail ?? {}) },
    };
    const now = options.now ?? new Date();
    const pendingWrite = inflight.get(key);
    if (pendingWrite) {
      /// 同一能力正在写：同状态直接搭车；状态不同（成功写到一半撞上额度错误）等它落地再写，不丢结论。
      if (sameState(pendingWrite.observation, observation)) return;
      await pendingWrite.promise.catch(() => undefined);
    }
    const known = cachedRecords().get(key);
    const lastWrite = lastRuntimeWrite.get(key) ?? (known ? Date.parse(known.checkedAt) : 0);
    if (sameState(known, observation) && now.getTime() - lastWrite < CAPABILITY_RUNTIME_REFRESH_MS) return;
    const store = defaultCapabilityStore();
    const promise = writeRuntime(key, observation, now, store).finally(() => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key);
    });
    inflight.set(key, { observation, promise });
    await promise;
  } catch (error) {
    console.warn(`[capabilities] 回写 ${key} 失败（已忽略）：`, (error as Error).message);
  }
}

/**
 * 探测批量落库：读上一份 → 逐条推进 → 写回，并刷新本实例缓存。单条写失败不影响其它条。
 */
export async function recordCapabilityObservations(
  observations: Array<{ key: CapabilityKey; observation: CapabilityObservation; source: CapabilitySource }>,
  options: { now?: Date; store?: CapabilityStore; previous?: Map<CapabilityKey, CapabilityRecord> } = {},
): Promise<CapabilityRecord[]> {
  const now = options.now ?? new Date();
  const store = options.store ?? defaultCapabilityStore();
  const previous = options.previous ?? new Map(
    (await store.readAll().catch(() => [] as CapabilityRecord[])).map((record) => [record.key, record]),
  );
  const next = observations.map(({ key, observation, source }) =>
    nextCapabilityRecord(previous.get(key), key, observation, now, source),
  );
  const results = await Promise.allSettled(next.map((record) => store.write(record)));
  const written = next.filter((_, index) => results[index]?.status === "fulfilled");
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`[capabilities] 写入 ${next[index]?.key} 失败：`, (result.reason as Error)?.message);
    }
  });
  rememberCapabilityRecords(written);
  return written;
}

export const __test__ = { CAPABILITY_KEYS, loadRecords };
