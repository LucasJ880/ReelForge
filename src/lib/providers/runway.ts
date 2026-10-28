/**
 * Runway 开发者 API 客户端（2026-10-28 商品主体轮：CEO 提议加 Runway；先写好等 key，小样对比定去留，
 * 见 docs/roadmap/2026-10-28-product-subject-plan.md §5.1）。
 *
 * 契约取自官方 Node SDK（github.com/runwayml/sdk-node）的类型定义：
 *   POST /v1/image_to_video · /v1/text_to_video · /v1/video_to_video → { id, estimatedCost: { credits } }
 *   GET  /v1/tasks/{id} → status ∈ PENDING | THROTTLED | RUNNING | SUCCEEDED | FAILED | CANCELLED
 *   DELETE /v1/tasks/{id}：排队 / 运行中的任务是取消，其余是删除；无响应体
 *   头：Authorization: Bearer <RUNWAYML_API_SECRET>，X-Runway-Version: 2024-11-06
 *
 * 计费：API 额度是独立钱包（网页版订阅付不了 API），1 credit = $0.01。
 * 产出 URL 24–48 小时就过期：拿到后要当场转存，不能当长期地址落库。
 *
 * ⚠️ 真机未验证（key 未到）：字段名与枚举照抄 SDK 类型，第一次真跑以真实响应为准，有出入先改这里。
 */

import { z } from "zod";

export const RUNWAY_API_BASE_URL = "https://api.dev.runwayml.com";
export const RUNWAY_API_VERSION = "2024-11-06";
/// 1 credit = $0.01（Runway API 定价页）
export const RUNWAY_USD_PER_CREDIT = 0.01;
const DEFAULT_TIMEOUT_MS = 60_000;

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface RunwayFetchOptions {
  fetchImpl?: typeof fetch;
  env?: Env;
  timeoutMs?: number;
}

export function runwayApiKey(env: Env = process.env): string | null {
  return env.RUNWAYML_API_SECRET?.trim() || null;
}

export function runwayBaseUrl(env: Env = process.env): string {
  return (env.RUNWAYML_BASE_URL?.trim() || RUNWAY_API_BASE_URL).replace(/\/+$/, "");
}

/// 视频模型（只列小样对比要跑的；id 与 SDK 的 model 字面量逐字一致）。Gen-4.5 / Gen-4 Turbo 的提示词上限 1000 字，
/// 装不下我们按故事板写的 4000+ 字提示词，不接。
export const RUNWAY_VIDEO_MODELS = ["seedance2_5", "klingO3_pro", "klingO3_standard"] as const;
export type RunwayVideoModel = (typeof RUNWAY_VIDEO_MODELS)[number];

export function isRunwayVideoModel(value: string): value is RunwayVideoModel {
  return (RUNWAY_VIDEO_MODELS as readonly string[]).includes(value);
}

export interface RunwayPromptImage {
  uri: string;
  position: "first" | "last";
}

export type RunwayVideoRequest =
  | {
      endpoint: "/v1/text_to_video";
      body: {
        model: "seedance2_5";
        promptText: string;
        ratio: string;
        duration: number;
        audio: boolean;
        references?: Array<{ uri: string }>;
        seed?: number;
      };
    }
  | {
      endpoint: "/v1/image_to_video";
      body: {
        model: RunwayVideoModel;
        promptImage: RunwayPromptImage[];
        promptText: string;
        ratio: string;
        duration: number;
        audio?: boolean;
        references?: Array<{ uri: string }>;
        seed?: number;
      };
    }
  | {
      endpoint: "/v1/video_to_video";
      body: {
        model: "aleph2";
        videoUri: string;
        promptText?: string;
        keyframes?: Array<{ at: number; uri: string }>;
        targetAspectRatio?: string;
        seed?: number;
      };
    };

export class RunwayApiError extends Error {
  constructor(
    message: string,
    /** HTTP 状态码；0 = 没拿到响应（网络 / 超时） */
    readonly status: number,
    /** Runway 文档：429 与 502/503/504 可重试；其余 4xx 是请求本身的问题 */
    readonly retryable: boolean,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "RunwayApiError";
  }
}

const createResponseSchema = z.object({
  id: z.string().min(1),
  estimatedCost: z.object({ credits: z.number().nonnegative() }).optional(),
});

const taskSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["PENDING", "THROTTLED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
  createdAt: z.string().optional(),
  progress: z.number().optional(),
  output: z.array(z.string()).optional(),
  failure: z.string().optional(),
  failureCode: z.string().optional(),
  cost: z.object({ credits: z.number().nonnegative() }).optional(),
  estimatedCost: z.object({ credits: z.number().nonnegative() }).optional(),
});

export type RunwayTask = z.infer<typeof taskSchema>;
export type RunwayTaskStatus = RunwayTask["status"];

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function runwayFetch(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
  options: RunwayFetchOptions,
): Promise<unknown> {
  const env = options.env ?? process.env;
  const key = runwayApiKey(env);
  if (!key) throw new RunwayApiError("Runway 未配置：缺少 RUNWAYML_API_SECRET", 0, false);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${runwayBaseUrl(env)}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Runway-Version": RUNWAY_API_VERSION,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RunwayApiError(`Runway 请求没有拿到响应：${(error as Error).message}`, 0, false, undefined);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : typeof body === "string"
          ? body.slice(0, 300)
          : response.statusText;
    throw new RunwayApiError(`Runway ${response.status}：${detail}`, response.status, isRetryableStatus(response.status), body);
  }
  return body;
}

export async function createRunwayTask(
  request: RunwayVideoRequest,
  options: RunwayFetchOptions = {},
): Promise<{ id: string; estimatedCredits: number | null }> {
  const body = await runwayFetch(request.endpoint, { method: "POST", body: request.body }, options);
  const parsed = createResponseSchema.safeParse(body);
  if (!parsed.success) {
    /// 200 但没有任务 id：任务可能已经建了，调用方必须按「不确定是否已建」处理
    throw new RunwayApiError("Runway 创建任务的响应里没有任务 id", 200, false, body);
  }
  return { id: parsed.data.id, estimatedCredits: parsed.data.estimatedCost?.credits ?? null };
}

export async function getRunwayTask(id: string, options: RunwayFetchOptions = {}): Promise<RunwayTask> {
  const body = await runwayFetch(`/v1/tasks/${encodeURIComponent(id)}`, { method: "GET" }, options);
  const parsed = taskSchema.safeParse(body);
  if (!parsed.success) {
    throw new RunwayApiError(`Runway 任务响应格式不认识：${parsed.error.issues[0]?.message ?? "unknown"}`, 200, true, body);
  }
  return parsed.data;
}

export async function cancelRunwayTask(id: string, options: RunwayFetchOptions = {}): Promise<void> {
  await runwayFetch(`/v1/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }, options);
}

/// 账户余额（GET /v1/organization）：对比前先看钱包够不够
export async function getRunwayCreditBalance(options: RunwayFetchOptions = {}): Promise<number | null> {
  const body = await runwayFetch("/v1/organization", { method: "GET" }, options);
  const balance = body && typeof body === "object" ? (body as { creditBalance?: unknown }).creditBalance : null;
  return typeof balance === "number" ? balance : null;
}

/// 竖 / 横 / 方三种画幅在各模型上的像素比（取自 SDK 的 ratio 枚举）
const RATIOS: Record<RunwayVideoModel, Record<"720p" | "1080p", Record<"9:16" | "16:9" | "1:1", string>>> = {
  seedance2_5: {
    "720p": { "9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960" },
    "1080p": { "9:16": "1080:1920", "16:9": "1920:1080", "1:1": "1440:1440" },
  },
  klingO3_pro: {
    "720p": { "9:16": "1080:1920", "16:9": "1920:1080", "1:1": "1440:1440" },
    "1080p": { "9:16": "1080:1920", "16:9": "1920:1080", "1:1": "1440:1440" },
  },
  klingO3_standard: {
    "720p": { "9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960" },
    "1080p": { "9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960" },
  },
};

export function runwayRatio(model: RunwayVideoModel, aspectRatio: string, resolution: string | undefined): string | null {
  const tier = resolution?.toLowerCase() === "1080p" ? "1080p" : "720p";
  const aspect = aspectRatio.trim();
  if (aspect !== "9:16" && aspect !== "16:9" && aspect !== "1:1") return null;
  return RATIOS[model][tier][aspect];
}

/// 每个模型能接受的提示词长度（SDK 注释）、参考图上限与时长范围（Runway 模型页）；promptMax null = SDK 没写上限
export const RUNWAY_MODEL_LIMITS: Record<RunwayVideoModel, { promptMax: number | null; referencesMax: number; minDuration: number; maxDuration: number }> = {
  seedance2_5: { promptMax: 15_000, referencesMax: 30, minDuration: 2, maxDuration: 30 },
  klingO3_pro: { promptMax: null, referencesMax: 7, minDuration: 3, maxDuration: 15 },
  klingO3_standard: { promptMax: null, referencesMax: 7, minDuration: 3, maxDuration: 15 },
};

export function runwayCreditsToUsd(credits: number): number {
  return Math.round(credits * RUNWAY_USD_PER_CREDIT * 100) / 100;
}
