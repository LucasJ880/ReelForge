import { z } from "zod";
import { ProviderSubmissionError } from "@/lib/video-generation/providers/submission-error";
import {
  parseShuyuCatalog,
  selectAuditedImage2Plan,
  type AuditedShuyuImagePlan,
} from "./shuyu-catalog";

export const SHUYU_API_BASE_URL =
  "https://shuyu-tiktok-tool.pages.dev/api/v1" as const;
export const SHUYU_VIDEO_PLAN_ID = "video-plan-02" as const;
export const SHUYU_VIDEO_MODEL = "studio-video" as const;
export const SHUYU_VIDEO_RESOLUTION = "720P" as const;
export const SHUYU_VIDEO_BILLING_UNIT = "generation" as const;
export const SHUYU_VIDEO_POINTS_PER_GENERATION = 900 as const;
/** GPT Image 2 · 推荐 — plan resolution rotates; prefer 01 then failover in pipeline. */
export const SHUYU_IMAGE_PLAN_ID = "image-plan-01" as const;
export const SHUYU_IMAGE_MODEL = "studio-image" as const;
export const SHUYU_IMAGE_RESOLUTION = "1K" as const;
export const SHUYU_IMAGE_POINTS_PER_GENERATION = 24 as const;
/** Fallback lane if the recommended plan is temporarily unavailable. */
export const SHUYU_IMAGE_FALLBACK_PLAN_ID = "image-plan-07" as const;
/**
 * Fast VIP recommended lane (88 pts/sec). Prefer for speed; for flat 15s cost
 * the audited `video-plan-02` (900/generation) is cheaper.
 */
export const SHUYU_VIDEO_FAST_PLAN_ID = "video-plan-03" as const;
export const SHUYU_VIDEO_FAST_POINTS_PER_SECOND = 88 as const;

const DEFAULT_TIMEOUT_MS = 8_000;
/**
 * Video-generation submission (POST /videos/generations) legitimately takes
 * longer to acknowledge than a status poll: the provider validates up to 9
 * image URLs and enqueues the task before responding. 0721 real-run取证:
 * 8s 默认值下约 1/4 的 image2video 提交在确认前被 abort，落入
 * acknowledgement_unknown 后 fail-closed，无法安全重试。给提交路径 45s 专用
 * 上限；状态轮询仍走 8s 默认。
 */
const VIDEO_SUBMIT_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 512_000;
const boundedIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const taskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "HTTPS URL required");

export const shuyuPriceSchema = z
  .object({
    plan_id: boundedIdentifier,
    kind: z.enum(["image", "video"]),
    model: boundedIdentifier,
    unit: z.enum(["generation", "second"]),
    resolution: boundedIdentifier,
    sale_points: z.number().int().nonnegative().max(10_000_000),
    display_name: z.string().trim().min(1).max(500),
    capabilities: z
      .object({
        aspect_ratios: z
          .array(z.enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "9:16", "16:9"]))
          .max(8),
        input_images_max: z.number().int().min(0).max(9),
        modes: z
          .array(z.enum(["text2video", "image2video", "frames2video"]))
          .max(3)
          .optional(),
        durations: z.array(z.number().int().min(1).max(15)).max(15).optional(),
        quality: z.enum(["480P", "720P", "1080P", "1K", "2K", "4K"]).optional(),
      })
      .strip(),
    status: z.literal("available"),
  })
  .strip();

export const shuyuPricesResponseSchema = z
  .object({
    object: z.literal("list"),
    data: z.array(shuyuPriceSchema).max(100),
  })
  .strip();

export const shuyuBalanceResponseSchema = z
  .object({
    object: z.literal("balance"),
    available_points: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    unit: z.literal("points"),
  })
  .strip();

export const shuyuHealthResponseSchema = z
  .object({
    object: z.literal("service_health"),
    status: z.literal("operational"),
    capabilities: z
      .object({
        image: z.literal("available"),
        video: z.literal("available"),
      })
      .strip(),
    checked_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strip();

const shuyuErrorDetailSchema = z
  .object({
    type: boundedIdentifier,
    message: z.string().trim().min(1).max(500),
    request_id: z.string().trim().min(1).max(200).optional(),
    available_points: z.number().int().nonnegative().optional(),
    required_points: z.number().int().nonnegative().optional(),
  })
  .strip();

/**
 * Shuyu 的错误网关存在两种等价形状：
 * `{ error: { type, message } }` 与 `{ type, message }`。统一归一为前者，
 * 避免退款确认等计费语义因为网关层差异而丢失。
 */
const shuyuErrorSchema = z.preprocess(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("error" in value) &&
    "type" in value &&
    "message" in value
      ? { error: value }
      : value,
  z.object({ error: shuyuErrorDetailSchema }).strip(),
);

export const shuyuCreateTaskResponseSchema = z
  .object({
    task_id: taskIdSchema.optional(),
    id: taskIdSchema.optional(),
  })
  .strip()
  .superRefine((value, context) => {
    if (!value.task_id && !value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A Shuyu task identifier is required",
      });
    }
    if (value.task_id && value.id && value.task_id !== value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Shuyu task identifiers must agree",
      });
    }
  });

export const SHUYU_TASK_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "refund_pending",
  "refund_error",
  "refunded",
] as const;

/**
 * Only documented task fields cross the adapter boundary. `id` is accepted as
 * a compatibility fallback because the create-success payload is not shown in
 * the public docs; `{task_id}` remains the primary documented identifier.
 */
export const shuyuTaskResponseSchema = z
  .object({
    task_id: taskIdSchema.optional(),
    id: taskIdSchema.optional(),
    status: z.enum(SHUYU_TASK_STATUSES),
    outputs: z
      .array(z.object({ url: httpsUrlSchema }).strip())
      .max(20)
      .optional(),
  })
  .strip();

export interface ShuyuFetchOptions {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  timeoutMs?: number;
}

export interface ShuyuCreateVideoInput extends ShuyuFetchOptions {
  providerRequestKey: string;
  prompt: string;
  duration: number;
  aspectRatio: string;
  inputImages: string[];
  /**
   * 调用方的原生音频意图；**Shuyu 代理不接受显式开关**，不会进请求体。
   *
   * 0728 真机实测：带上该字段会被整条拒绝
   *   `提交被拒绝: Unknown request field: generate_audio.`
   * 但历史原始 Shuyu 成片在未发送该字段时确实自带音轨，并会按 prompt
   * 里的 Dialogue / Audio 指令生成口播。因此这里只省略代理不支持的字段，
   * 音频意图继续由提示词传给上游，不能改走另一家 TTS。
   */
  generateAudio?: boolean;
  model?: string;
  /** Defaults to audited `SHUYU_VIDEO_PLAN_ID`. Acceptance may pass Fast VIP. */
  planId?: string;
}

export interface ShuyuCreateImageInput extends ShuyuFetchOptions {
  providerRequestKey: string;
  prompt: string;
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:3" | "3:4" | "4:5" | "2:3" | "3:2";
  resolution?: "1K" | "2K" | "4K";
  inputImages?: string[];
  planId?: string;
  model?: string;
}

export class ShuyuApiError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "authentication_rejected"
      | "insufficient_balance"
      | "rate_limited"
      | "not_found"
      | "timeout"
      | "upstream_unavailable"
      | "invalid_response",
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ShuyuApiError";
  }
}

export function shuyuApiKey(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  // SHUYU_API_KEY is canonical for new deployments. The lowercase variable is
  // retained because it is already configured in Vercel and local environments.
  return env.SHUYU_API_KEY?.trim() || env.shuyu_api_key?.trim() || null;
}

export function isAuditedShuyuVideoPlan(
  plan: z.infer<typeof shuyuPriceSchema>,
): boolean {
  return (
    plan.plan_id === SHUYU_VIDEO_PLAN_ID &&
    plan.kind === "video" &&
    plan.model === SHUYU_VIDEO_MODEL &&
    plan.unit === SHUYU_VIDEO_BILLING_UNIT &&
    plan.resolution === SHUYU_VIDEO_RESOLUTION &&
    plan.sale_points === SHUYU_VIDEO_POINTS_PER_GENERATION &&
    plan.status === "available" &&
    (plan.capabilities.quality === SHUYU_VIDEO_RESOLUTION ||
      plan.capabilities.quality === undefined) &&
    plan.capabilities.input_images_max >= 9 &&
    plan.capabilities.aspect_ratios.includes("9:16") &&
    plan.capabilities.aspect_ratios.includes("16:9") &&
    plan.capabilities.aspect_ratios.includes("1:1") &&
    (plan.capabilities.modes?.includes("text2video") ?? false) &&
    (plan.capabilities.modes?.includes("image2video") ?? false) &&
    // Live /prices may omit frames2video; image2video is the SunnyShutter path.
    (plan.capabilities.durations?.includes(15) ?? false)
  );
}

/** Locate the audited video plan among a multi-plan price list. */
export function findAuditedShuyuVideoPlan(
  plans: ReadonlyArray<z.infer<typeof shuyuPriceSchema>>,
): z.infer<typeof shuyuPriceSchema> | undefined {
  return plans.find((plan) => plan.kind === "video" && isAuditedShuyuVideoPlan(plan));
}

function timeoutMs(value: number | undefined): number {
  // Cap raised to 45s so the video-submit path can request a longer ack window
  // than a status poll; the 8s default is unchanged for callers that pass none.
  return Math.min(
    VIDEO_SUBMIT_TIMEOUT_MS,
    Math.max(250, Math.floor(value ?? DEFAULT_TIMEOUT_MS)),
  );
}

function safeProviderMessage(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 500);
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

async function readChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void reader.cancel().catch(() => undefined);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

async function readBoundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ShuyuApiError(
      "Shuyu returned an empty or oversized response",
      "invalid_response",
      response.status,
    );
  }
  if (!response.body) {
    throw new ShuyuApiError(
      "Shuyu returned an empty or oversized response",
      "invalid_response",
      response.status,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let raw = "";
  try {
    while (true) {
      const chunk = await readChunkWithAbort(reader, signal);
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ShuyuApiError(
          "Shuyu returned an empty or oversized response",
          "invalid_response",
          response.status,
        );
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0 || raw.length === 0) {
    throw new ShuyuApiError(
      "Shuyu returned an empty or oversized response",
      "invalid_response",
      response.status,
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ShuyuApiError(
      "Shuyu returned non-JSON data",
      "invalid_response",
      response.status,
    );
  }
}

function getErrorCode(status: number): ShuyuApiError["code"] {
  if (status === 401 || status === 403) return "authentication_rejected";
  if (status === 402) return "insufficient_balance";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "upstream_unavailable";
}

async function shuyuFetchJson(
  path: string,
  init: RequestInit,
  options: ShuyuFetchOptions,
): Promise<{ response: Response; payload: unknown }> {
  const apiKey = shuyuApiKey(options.env);
  if (!apiKey) {
    throw new ShuyuApiError("Shuyu API key is not configured", "not_configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(options.timeoutMs));
  try {
    const response = await (options.fetchImpl ?? fetch)(`${SHUYU_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const payload = await readBoundedJson(response, controller.signal);
    return { response, payload };
  } catch (error) {
    if (error instanceof ShuyuApiError) throw error;
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new ShuyuApiError("Shuyu request timed out", "timeout");
    }
    throw new ShuyuApiError("Shuyu request failed", "upstream_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export async function getShuyuPrices(
  options: ShuyuFetchOptions = {},
): Promise<z.infer<typeof shuyuPricesResponseSchema>> {
  const { response, payload } = await shuyuFetchJson(
    "/prices",
    { method: "GET" },
    options,
  );
  if (!response.ok) {
    const parsed = shuyuErrorSchema.safeParse(payload);
    throw new ShuyuApiError(
      parsed.success
        ? safeProviderMessage(parsed.data.error.message)
        : `Shuyu prices request failed (${response.status})`,
      getErrorCode(response.status),
      response.status,
    );
  }
  const parsed = shuyuPricesResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ShuyuApiError(
      "Shuyu returned an invalid prices response",
      "invalid_response",
      response.status,
    );
  }
  return parsed.data;
}

/** Return only currently available, audited GPT Image 2 plans and metadata. */
export async function getAvailableShuyuImagePlans(
  options: ShuyuFetchOptions = {},
): Promise<AuditedShuyuImagePlan[]> {
  const prices = await getShuyuPrices(options);
  return parseShuyuCatalog(prices).imagePlans;
}

/**
 * 从供应商实时目录解析图像套餐。
 *
 * 合作方会轮换 plan id（源码里 SHUYU_IMAGE_PLAN_ID 旁的注释早已预告
 * "plan resolution rotates"，但故障转移一直没落地）。0728 真机实测：
 * 硬编码的主 `image-plan-01` 与备 `image-plan-07` 都已从目录中消失，
 * 目录只剩 02/03/05/06/08/09 且最低档为 2K —— 于是每一帧提交都被回
 * `400 model_unavailable`，故事板全灭、批次卡死。注意 /health 仍报
 * `image: available`，健康检查发现不了这类失配。
 *
 * 选取策略：优先满足所需分辨率，同档取积分最低者；请求 1K 时回落到最低可用档
 * （目录已无 1K）。结果做短缓存，避免每帧都打一次价格表。
 */
const IMAGE_PLAN_CACHE_TTL_MS = 5 * 60_000;
let imagePlanCache: { at: number; plans: AuditedShuyuImagePlan[] } | null = null;

/** 仅供测试：清空套餐缓存。 */
export function __resetShuyuImagePlanCache(): void {
  imagePlanCache = null;
}

export async function resolveShuyuImagePlan(
  requested: { resolution?: "1K" | "2K" | "4K" } & ShuyuFetchOptions = {},
): Promise<AuditedShuyuImagePlan> {
  const now = Date.now();
  if (!imagePlanCache || now - imagePlanCache.at > IMAGE_PLAN_CACHE_TTL_MS) {
    imagePlanCache = { at: now, plans: await getAvailableShuyuImagePlans(requested) };
  }
  /// 档位回落策略集中在 selectAuditedImage2Plan，避免两处各写一份而漂移。
  return selectAuditedImage2Plan(
    { imagePlans: imagePlanCache.plans },
    requested.resolution ?? "2K",
  );
}

export async function getShuyuBalance(
  options: ShuyuFetchOptions = {},
): Promise<z.infer<typeof shuyuBalanceResponseSchema>> {
  const { response, payload } = await shuyuFetchJson(
    "/account/balance",
    { method: "GET" },
    options,
  );
  if (!response.ok) {
    const parsed = shuyuErrorSchema.safeParse(payload);
    throw new ShuyuApiError(
      parsed.success
        ? safeProviderMessage(parsed.data.error.message)
        : `Shuyu balance request failed (${response.status})`,
      getErrorCode(response.status),
      response.status,
    );
  }
  const parsed = shuyuBalanceResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ShuyuApiError(
      "Shuyu returned an invalid balance response",
      "invalid_response",
      response.status,
    );
  }
  return parsed.data;
}

export async function getShuyuHealth(
  options: ShuyuFetchOptions = {},
): Promise<z.infer<typeof shuyuHealthResponseSchema>> {
  const { response, payload } = await shuyuFetchJson(
    "/health",
    { method: "GET" },
    options,
  );
  if (!response.ok) {
    const parsed = shuyuErrorSchema.safeParse(payload);
    throw new ShuyuApiError(
      parsed.success
        ? safeProviderMessage(parsed.data.error.message)
        : `Shuyu health request failed (${response.status})`,
      getErrorCode(response.status),
      response.status,
    );
  }
  const parsed = shuyuHealthResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ShuyuApiError(
      "Shuyu returned an invalid health response",
      "invalid_response",
      response.status,
    );
  }
  return parsed.data;
}

/**
 * Shuyu 在「线路繁忙」时会明确回执已退还积分，例如 0728 真机实测：
 *   HTTP 502 · {"type":"generation_failed",
 *               "message":"线路繁忙，请刷新或切换线路后重试。积分已退回。"}
 *
 * 这句退款声明是供应商对「本次没有产生任务、也没有计费」的显式确认，
 * 因而可以安全地当作 definitely_not_created 并重试；否则该帧会停在
 * ACK_UNKNOWN 永不重投，故事板判失败，整个批次卡在 QUEUED 无人推进。
 *
 * 只认这一条显式信号，不放宽全部 5xx —— 未声明退款的 5xx 仍按可能已计费处理。
 */
const REFUND_CONFIRMED_PATTERNS = [
  /积分已退回/,
  /积分已退还/,
  /credits?\s+(have\s+been\s+)?refunded/i,
];

function providerConfirmedRefund(message: string): boolean {
  return REFUND_CONFIRMED_PATTERNS.some((pattern) => pattern.test(message));
}

function createSubmissionError(args: {
  response: Response;
  payload: unknown;
}): ProviderSubmissionError {
  const parsed = shuyuErrorSchema.safeParse(args.payload);
  const status = args.response.status;
  const rawMessage = parsed.success ? parsed.data.error.message : "";
  const message = parsed.success
    ? safeProviderMessage(parsed.data.error.message)
    : `Shuyu video submission failed (${status})`;
  const code = parsed.success ? parsed.data.error.type : undefined;
  // These documented 4xx responses reject the submitted request. 409 remains
  // acknowledgement-unknown because an idempotency conflict can point to an
  // already-created task whose ID was not returned to this caller.
  const statusConfirmsNoJob = [400, 401, 402, 403, 404, 429].includes(status);
  const refunded = providerConfirmedRefund(rawMessage);
  return new ProviderSubmissionError(message, {
    providerId: "shuyu",
    stage: "provider_response",
    httpStatus: status,
    code,
    providerConfirmedNoJob: statusConfirmsNoJob || refunded,
    /// 退款已确认 = 重投不会二次计费，允许自动重试把「线路繁忙」熬过去。
    retryable: refunded,
  });
}

export async function createShuyuImageTask(
  input: ShuyuCreateImageInput,
): Promise<{ taskId: string }> {
  const providerRequestKey = input.providerRequestKey.trim();
  if (providerRequestKey.length < 8 || providerRequestKey.length > 120) {
    throw new ProviderSubmissionError(
      "Shuyu requires a persisted Idempotency-Key",
      { providerId: "shuyu", stage: "preflight", retryable: false },
    );
  }
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 5_000) {
    throw new ProviderSubmissionError(
      prompt.length > 5_000
        ? "Shuyu image prompt must not exceed 5000 characters"
        : "Shuyu image prompt is required",
      { providerId: "shuyu", stage: "preflight", retryable: false },
    );
  }
  const inputImages = (input.inputImages ?? [])
    .map((url) => url.trim())
    .filter(Boolean);
  if (inputImages.length > 5) {
    throw new ProviderSubmissionError(
      "Shuyu image accepts at most 5 HTTPS reference images",
      { providerId: "shuyu", stage: "preflight", retryable: false },
    );
  }
  if (inputImages.some((value) => {
    try {
      const url = new URL(value);
      return url.protocol !== "https:" || Boolean(url.username || url.password);
    } catch {
      return true;
    }
  })) {
    throw new ProviderSubmissionError(
      "Shuyu image accepts only HTTPS reference images",
      { providerId: "shuyu", stage: "preflight", retryable: false },
    );
  }

  /// 未显式指定套餐时按实时目录解析：合作方轮换 plan id 后硬编码常量会全量失效。
  const resolved = input.planId
    ? null
    : await resolveShuyuImagePlan({ ...input, resolution: input.resolution });
  const body = {
    plan_id: input.planId ?? resolved!.planId,
    model: input.model ?? SHUYU_IMAGE_MODEL,
    prompt,
    resolution: input.resolution && input.planId
      ? input.resolution
      : (resolved?.resolution ?? SHUYU_IMAGE_RESOLUTION),
    aspect_ratio: input.aspectRatio ?? "9:16",
    ...(inputImages.length > 0 ? { input_images: inputImages } : {}),
  };

  let response: Response;
  let payload: unknown;
  try {
    const result = await shuyuFetchJson(
      "/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": providerRequestKey,
        },
        body: JSON.stringify(body),
      },
      input,
    );
    response = result.response;
    payload = result.payload;
  } catch (error) {
    if (error instanceof ProviderSubmissionError) throw error;
    throw new ProviderSubmissionError(
      error instanceof Error ? error.message : "Shuyu image request failed",
      {
        providerId: "shuyu",
        stage:
          error instanceof ShuyuApiError && error.code === "invalid_response"
            ? "response_decode"
            : "transport",
        httpStatus:
          error instanceof ShuyuApiError ? error.httpStatus : undefined,
        retryable: false,
        cause: error,
      },
    );
  }
  if (!response.ok) throw createSubmissionError({ response, payload });

  const parsed = shuyuCreateTaskResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProviderSubmissionError(
      "Shuyu accepted the image request but returned no valid task identifier",
      {
        providerId: "shuyu",
        stage: "response_decode",
        httpStatus: response.status,
        retryable: false,
      },
    );
  }
  const taskId = parsed.data.task_id ?? parsed.data.id;
  if (!taskId) {
    throw new ProviderSubmissionError(
      "Shuyu accepted the image request but returned no valid task identifier",
      {
        providerId: "shuyu",
        stage: "response_decode",
        httpStatus: response.status,
        retryable: false,
      },
    );
  }
  return { taskId };
}

export async function createShuyuVideoTask(
  input: ShuyuCreateVideoInput,
): Promise<{ taskId: string }> {
  const providerRequestKey = input.providerRequestKey.trim();
  if (providerRequestKey.length < 8 || providerRequestKey.length > 120) {
    throw new ProviderSubmissionError(
      "Shuyu requires a persisted Idempotency-Key",
      { providerId: "shuyu", stage: "preflight", retryable: false },
    );
  }

  const body = {
    plan_id: input.planId ?? SHUYU_VIDEO_PLAN_ID,
    model: input.model ?? SHUYU_VIDEO_MODEL,
    mode:
      input.inputImages.length === 0
        ? "text2video"
        : "image2video",
    prompt: input.prompt,
    duration: input.duration,
    aspect_ratio: input.aspectRatio,
    input_images: input.inputImages,
  };
  let response: Response;
  let payload: unknown;
  try {
    const result = await shuyuFetchJson(
      "/videos/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": providerRequestKey,
        },
        body: JSON.stringify(body),
      },
      { ...input, timeoutMs: input.timeoutMs ?? VIDEO_SUBMIT_TIMEOUT_MS },
    );
    response = result.response;
    payload = result.payload;
  } catch (error) {
    if (error instanceof ProviderSubmissionError) throw error;
    throw new ProviderSubmissionError(
      error instanceof Error ? error.message : "Shuyu request failed",
      {
        providerId: "shuyu",
        stage:
          error instanceof ShuyuApiError && error.code === "invalid_response"
            ? "response_decode"
            : "transport",
        httpStatus:
          error instanceof ShuyuApiError ? error.httpStatus : undefined,
        retryable: false,
        cause: error,
      },
    );
  }
  if (!response.ok) throw createSubmissionError({ response, payload });

  const parsed = shuyuCreateTaskResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProviderSubmissionError(
      "Shuyu accepted the request but returned no valid task identifier",
      {
        providerId: "shuyu",
        stage: "response_decode",
        httpStatus: response.status,
        retryable: false,
      },
    );
  }
  const taskId = parsed.data.task_id ?? parsed.data.id;
  if (!taskId) {
    throw new ProviderSubmissionError(
      "Shuyu accepted the request but returned no valid task identifier",
      {
        providerId: "shuyu",
        stage: "response_decode",
        httpStatus: response.status,
        retryable: false,
      },
    );
  }
  return { taskId };
}

export async function getShuyuVideoTask(
  taskId: string,
  options: ShuyuFetchOptions = {},
): Promise<z.infer<typeof shuyuTaskResponseSchema>> {
  const parsedId = taskIdSchema.safeParse(taskId);
  if (!parsedId.success) {
    throw new ShuyuApiError("Invalid Shuyu task identifier", "invalid_response");
  }
  const { response, payload } = await shuyuFetchJson(
    `/tasks/${encodeURIComponent(parsedId.data)}`,
    { method: "GET" },
    options,
  );
  if (!response.ok) {
    const parsed = shuyuErrorSchema.safeParse(payload);
    throw new ShuyuApiError(
      parsed.success
        ? safeProviderMessage(parsed.data.error.message)
        : `Shuyu task request failed (${response.status})`,
      getErrorCode(response.status),
      response.status,
    );
  }
  const parsed = shuyuTaskResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ShuyuApiError(
      "Shuyu returned an invalid task response",
      "invalid_response",
      response.status,
    );
  }
  if (
    (parsed.data.task_id && parsed.data.task_id !== parsedId.data)
    || (parsed.data.id && parsed.data.id !== parsedId.data)
  ) {
    throw new ShuyuApiError(
      "Shuyu returned a task response for a different identifier",
      "invalid_response",
      response.status,
    );
  }
  return parsed.data;
}
