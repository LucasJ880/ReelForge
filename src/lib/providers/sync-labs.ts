/**
 * Sync Labs（sync.so）后置对口型客户端（P04-F 适配器层，D-13 默认口型路线）。
 *
 * 路线：Shuyu 出片（段）→ 外部 TTS 音轨（providers/tts，优先带逐词时间戳）→ 本客户端对口型 →
 * 换段 outputVideoUrl 后重拼；失败回退原段 + 叠音轨。**本文件只做供应商 HTTP 契约**：
 * 创建 / 查询 / 状态映射 / 成本估算，不写库、不碰状态机。段级编排（poll-videos 内推进、
 * 换挂、回退、计费）另接；在那之前 `voiceover.drive=tts_lipsync` 对所有线路仍 422（voiceover-drive.ts）。
 *
 * 契约（2026-10-26 官方文档 sync.so/docs/api-reference/api/generate-api）：
 *   POST https://api.sync.so/v2/generate   x-api-key   {model, input:[{type:"video",url},{type:"audio",url}], options:{sync_mode}}
 *   GET  https://api.sync.so/v2/generate/{id}          → {id, status: PENDING|PROCESSING|COMPLETED|FAILED|REJECTED, outputUrl?, outputDuration?, error?}
 *   可选头 Idempotency-Key（1–128，[A-Za-z0-9._~-]）。
 *
 * 只用 `SYNC_API_KEY`；无 key 诚实不可用，不 mock（铁律 3）。真机参数（模型档、sync_mode、
 * 「静音段 + 后置」与「原生 + 后置」谁更稳）由 E8′ 预注册判据定，这里只给可配置的缺省。
 */

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

export const SYNC_API_BASE = "https://api.sync.so";
/** D-13 按 sync-3 计价（$0.107–0.133/s）；E8′ 若证明 lipsync-2 够用再降档。 */
export const SYNC_DEFAULT_LIPSYNC_MODEL = "sync-3";
export const SYNC_LIPSYNC_MODELS = ["sync-3", "lipsync-2", "lipsync-2-pro", "lipsync-1.9.0-beta"] as const;
export type SyncLipsyncModel = (typeof SYNC_LIPSYNC_MODELS)[number];
/**
 * 音视频长度不一致时的处理。口播按段时长切（P04-C）后音轨 ≤ 段长，缺省 `silence`：
 * 说完的部分保持画面不动口、不回弹不循环，段长不变才不打乱 FinalVideo 的时间轴。
 */
export const SYNC_LIPSYNC_SYNC_MODES = ["bounce", "loop", "cut_off", "silence", "remap"] as const;
export type SyncLipsyncSyncMode = (typeof SYNC_LIPSYNC_SYNC_MODES)[number];
export const SYNC_DEFAULT_SYNC_MODE: SyncLipsyncSyncMode = "silence";
/** 成本上界（USD/秒）：额度口径按上界估，真价以供应商账单为准。 */
export const SYNC_DEFAULT_USD_PER_SECOND = 0.133;

export const SYNC_GENERATION_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REJECTED"] as const;
export type SyncGenerationStatus = (typeof SYNC_GENERATION_STATUSES)[number];

export interface SyncFetchOptions {
  fetchImpl?: typeof fetch;
  env?: EnvLike;
  timeoutMs?: number;
}

export interface SyncGeneration {
  id: string;
  status: SyncGenerationStatus;
  outputUrl: string | null;
  outputDurationSec: number | null;
  error: string | null;
  errorCode: string | null;
}

export type SyncLipsyncStage = "preflight" | "create" | "poll";

export class SyncLipsyncError extends Error {
  constructor(
    message: string,
    readonly stage: SyncLipsyncStage,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SyncLipsyncError";
  }
}

export function isSyncConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.SYNC_API_KEY?.trim());
}

export function resolveSyncLipsyncModel(env: EnvLike = process.env): SyncLipsyncModel {
  const raw = env.SYNC_LIPSYNC_MODEL?.trim();
  return raw && (SYNC_LIPSYNC_MODELS as readonly string[]).includes(raw)
    ? (raw as SyncLipsyncModel)
    : SYNC_DEFAULT_LIPSYNC_MODEL;
}

export function resolveSyncLipsyncSyncMode(env: EnvLike = process.env): SyncLipsyncSyncMode {
  const raw = env.SYNC_LIPSYNC_SYNC_MODE?.trim();
  return raw && (SYNC_LIPSYNC_SYNC_MODES as readonly string[]).includes(raw)
    ? (raw as SyncLipsyncSyncMode)
    : SYNC_DEFAULT_SYNC_MODE;
}

export function resolveSyncUsdPerSecond(env: EnvLike = process.env): number {
  const raw = Number(env.SYNC_LIPSYNC_USD_PER_SECOND?.trim());
  return Number.isFinite(raw) && raw > 0 ? raw : SYNC_DEFAULT_USD_PER_SECOND;
}

/** 额度口径的成本估算（USD，按上界、按秒向上取整）。 */
export function estimateSyncLipsyncCostUsd(durationSec: number, env: EnvLike = process.env): number {
  const seconds = Math.max(0, Math.ceil(durationSec));
  return Number((seconds * resolveSyncUsdPerSecond(env)).toFixed(4));
}

/** 供应商状态 → 我方统一状态；REJECTED（审核 / 输入被拒）不可重试。 */
export function mapSyncGenerationStatus(
  status: SyncGenerationStatus,
): { state: "queued" | "processing" | "succeeded" | "failed"; retryable: boolean } {
  switch (status) {
    case "PENDING":
      return { state: "queued", retryable: true };
    case "PROCESSING":
      return { state: "processing", retryable: true };
    case "COMPLETED":
      return { state: "succeeded", retryable: false };
    case "FAILED":
      return { state: "failed", retryable: true };
    case "REJECTED":
      return { state: "failed", retryable: false };
  }
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~-]{1,128}$/;

function assertHttpsUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SyncLipsyncError(`${label} 不是合法 URL`, "preflight", null, false);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new SyncLipsyncError(`${label} 只接受 HTTPS 公网地址`, "preflight", null, false);
  }
  return parsed.toString();
}

async function syncFetch(
  path: string,
  init: RequestInit,
  options: SyncFetchOptions,
  stage: SyncLipsyncStage,
): Promise<{ status: number; payload: unknown; bodyText: string }> {
  const env = options.env ?? process.env;
  const key = env.SYNC_API_KEY?.trim();
  if (!key) throw new SyncLipsyncError("SYNC_API_KEY 未配置，后置对口型不可用", "preflight", null, false);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${SYNC_API_BASE}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), "x-api-key": key },
        signal: controller.signal,
      });
    } catch (error) {
      throw new SyncLipsyncError(
        `Sync 请求失败：${error instanceof Error ? error.message : String(error)}`,
        stage,
        null,
        true,
      );
    }
    const bodyText = await response.text().catch(() => "");
    let payload: unknown = null;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      /// 日志脱敏：只留状态码与截断的错误体，不落 key、不落素材 URL。
      const retryable = response.status === 429 || response.status >= 500;
      throw new SyncLipsyncError(
        `Sync HTTP ${response.status} ${bodyText.slice(0, 200)}`,
        stage,
        response.status,
        retryable,
      );
    }
    return { status: response.status, payload, bodyText };
  } finally {
    clearTimeout(timer);
  }
}

function parseGeneration(payload: unknown, stage: SyncLipsyncStage): SyncGeneration {
  if (!payload || typeof payload !== "object") {
    throw new SyncLipsyncError("Sync 返回的不是 JSON 对象", stage, null, true);
  }
  const record = payload as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const status = typeof record.status === "string" ? record.status.trim().toUpperCase() : "";
  if (!id || !(SYNC_GENERATION_STATUSES as readonly string[]).includes(status)) {
    throw new SyncLipsyncError(`Sync 返回缺少 id / 未知 status（${status || "?"}）`, stage, null, true);
  }
  const outputUrl = typeof record.outputUrl === "string" && record.outputUrl.trim() ? record.outputUrl.trim() : null;
  const outputDuration =
    typeof record.outputDuration === "number" && Number.isFinite(record.outputDuration) ? record.outputDuration : null;
  return {
    id,
    status: status as SyncGenerationStatus,
    outputUrl,
    outputDurationSec: outputDuration,
    error: typeof record.error === "string" && record.error ? record.error.slice(0, 500) : null,
    errorCode: typeof record.errorCode === "string" && record.errorCode ? record.errorCode : null,
  };
}

export interface CreateSyncLipsyncInput extends SyncFetchOptions {
  videoUrl: string;
  audioUrl: string;
  /** 段级幂等键（如 `${videoJobId}:lipsync:${attempt}`），只允许 [A-Za-z0-9._~-]，1–128。 */
  idempotencyKey?: string;
  model?: SyncLipsyncModel;
  syncMode?: SyncLipsyncSyncMode;
  /** 只允许字母数字 / 下划线 / 连字符（供应商会自动加 .mp4）。 */
  outputFileName?: string;
}

/** 创建一次对口型生成：只提交，不等待；返回供应商 id 与初始状态，供编排层落库后轮询。 */
export async function createSyncLipsyncGeneration(input: CreateSyncLipsyncInput): Promise<SyncGeneration> {
  const env = input.env ?? process.env;
  const videoUrl = assertHttpsUrl(input.videoUrl, "视频");
  const audioUrl = assertHttpsUrl(input.audioUrl, "音轨");
  if (input.idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    throw new SyncLipsyncError("Idempotency-Key 只允许 [A-Za-z0-9._~-]，1–128 位", "preflight", null, false);
  }
  if (input.outputFileName !== undefined && !/^[A-Za-z0-9_-]{1,255}$/.test(input.outputFileName)) {
    throw new SyncLipsyncError("outputFileName 只允许字母数字、下划线与连字符", "preflight", null, false);
  }
  const body = {
    model: input.model ?? resolveSyncLipsyncModel(env),
    input: [
      { type: "video", url: videoUrl },
      { type: "audio", url: audioUrl },
    ],
    options: { sync_mode: input.syncMode ?? resolveSyncLipsyncSyncMode(env) },
    ...(input.outputFileName ? { outputFileName: input.outputFileName } : {}),
  };
  const { payload } = await syncFetch(
    "/v2/generate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    },
    input,
    "create",
  );
  return parseGeneration(payload, "create");
}

/** 查询一次生成的状态；COMPLETED 时 outputUrl 非空，FAILED / REJECTED 时 error 非空（尽力）。 */
export async function getSyncLipsyncGeneration(
  id: string,
  options: SyncFetchOptions = {},
): Promise<SyncGeneration> {
  const trimmed = id.trim();
  if (!trimmed) throw new SyncLipsyncError("缺少 Sync 生成 id", "preflight", null, false);
  const { payload } = await syncFetch(
    `/v2/generate/${encodeURIComponent(trimmed)}`,
    { method: "GET" },
    options,
    "poll",
  );
  const generation = parseGeneration(payload, "poll");
  if (generation.status === "COMPLETED" && !generation.outputUrl) {
    throw new SyncLipsyncError("Sync 报告 COMPLETED 但没有 outputUrl", "poll", null, true);
  }
  return generation;
}
