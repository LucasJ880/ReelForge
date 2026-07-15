import { z } from "zod";
import { ProviderSubmissionError } from "@/lib/video-generation/providers/submission-error";

export const SHUYU_API_BASE_URL =
  "https://shuyu-tiktok-tool.pages.dev/api/v1" as const;
export const SHUYU_VIDEO_PLAN_ID = "video-standard-720p-second" as const;
export const SHUYU_VIDEO_MODEL = "studio-video" as const;
export const SHUYU_VIDEO_RESOLUTION = "720P" as const;
export const SHUYU_VIDEO_BILLING_UNIT = "second" as const;
export const SHUYU_VIDEO_POINTS_PER_SECOND = 104 as const;

const DEFAULT_TIMEOUT_MS = 8_000;
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

const shuyuErrorSchema = z
  .object({
    error: z
      .object({
        type: boundedIdentifier,
        message: z.string().trim().min(1).max(500),
        request_id: z.string().trim().min(1).max(200).optional(),
        available_points: z.number().int().nonnegative().optional(),
        required_points: z.number().int().nonnegative().optional(),
      })
      .strip(),
  })
  .strip();

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
    outputs: z.array(httpsUrlSchema).max(20).optional(),
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
    plan.sale_points === SHUYU_VIDEO_POINTS_PER_SECOND
  );
}

function timeoutMs(value: number | undefined): number {
  return Math.min(20_000, Math.max(250, Math.floor(value ?? DEFAULT_TIMEOUT_MS)));
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

function createSubmissionError(args: {
  response: Response;
  payload: unknown;
}): ProviderSubmissionError {
  const parsed = shuyuErrorSchema.safeParse(args.payload);
  const status = args.response.status;
  const message = parsed.success
    ? safeProviderMessage(parsed.data.error.message)
    : `Shuyu video submission failed (${status})`;
  const code = parsed.success ? parsed.data.error.type : undefined;
  // These documented 4xx responses reject the submitted request. 409 remains
  // acknowledgement-unknown because an idempotency conflict can point to an
  // already-created task whose ID was not returned to this caller.
  const providerConfirmedNoJob = [400, 401, 402, 403, 404, 429].includes(status);
  return new ProviderSubmissionError(message, {
    providerId: "shuyu",
    stage: "provider_response",
    httpStatus: status,
    code,
    providerConfirmedNoJob,
    retryable: false,
  });
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
    model: input.model ?? SHUYU_VIDEO_MODEL,
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
      input,
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
