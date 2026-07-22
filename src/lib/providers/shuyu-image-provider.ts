import type { AuditedShuyuImagePlan, ShuyuResolution } from "./shuyu-catalog";
import { selectAuditedImage2Plan } from "./shuyu-catalog";
import { randomUUID } from "node:crypto";
import { isDryRun } from "@/lib/config/dry-run";
import { isProductionRuntime } from "@/lib/config/env";
import { ProviderSubmissionError } from "@/lib/video-generation/providers/submission-error";
import {
  createShuyuImageTask,
  getAvailableShuyuImagePlans,
  getShuyuVideoTask,
  type ShuyuFetchOptions,
} from "./shuyu";

const DEFAULT_OUTPUT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const DEFAULT_OUTPUT_HOSTS = [
  "shuyu-tiktok-tool.pages.dev",
  "ark-acg-cn-beijing.tos-cn-beijing.volces.com",
  // Shuyu 2026-07 起把图片产出迁到了这个 Cloudflare R2 公共桶（真机任务实测）。
  "pub-e3efa798bda34fd0a8bf550fca3b297f.r2.dev",
] as const;
const MOCK_OUTPUT_PREFIX = "https://shuyu-tiktok-tool.pages.dev/mock-output/";
const MOCK_IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function mockImageRuntime(): boolean {
  const explicitMock = /^(1|true|yes|on)$/i.test(
    process.env.IMAGE_ENGINE_MOCK?.trim() ?? "",
  );
  const mock = isDryRun() || explicitMock;
  if (mock && isProductionRuntime()) {
    throw new Error("production runtime 禁止 mock Shuyu 图片 provider");
  }
  return mock;
}

function mockPlan(resolution: ShuyuResolution): AuditedShuyuImagePlan {
  const ordinal = resolution === "1K" ? "01" : resolution === "2K" ? "02" : "03";
  const points = resolution === "1K" ? 24 : resolution === "2K" ? 32 : 64;
  return {
    planId: `image-plan-${ordinal}`,
    model: "gpt-image-2",
    resolution,
    points,
    family: "gpt-image-2",
  };
}

export type ShuyuImageAspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "9:16"
  | "16:9";

export interface SubmitShuyuImageTaskInput extends ShuyuFetchOptions {
  requestKey: string;
  prompt: string;
  aspectRatio: ShuyuImageAspectRatio;
  resolution: ShuyuResolution;
  inputImages?: string[];
  planSnapshot?: AuditedShuyuImagePlan;
  onPlanSelected?: (plan: AuditedShuyuImagePlan) => Promise<void>;
}

export interface ShuyuImageTaskResult {
  status: "queued" | "processing" | "succeeded" | "failed";
  rawStatus: string;
  outputUrls: string[];
  errorMessage?: string;
}

export async function submitShuyuImageTask(
  input: SubmitShuyuImageTaskInput,
): Promise<{
  requestKey: string;
  externalTaskId: string;
  planSnapshot: AuditedShuyuImagePlan;
}> {
  if (mockImageRuntime()) {
    const planSnapshot = input.planSnapshot ?? mockPlan(input.resolution);
    await input.onPlanSelected?.(planSnapshot);
    return {
      requestKey: input.requestKey,
      externalTaskId: `mock_shuyu_image_${randomUUID()}`,
      planSnapshot,
    };
  }
  let planSnapshot: AuditedShuyuImagePlan;
  try {
    if (input.planSnapshot) {
      planSnapshot = input.planSnapshot;
    } else {
      const plans = await getAvailableShuyuImagePlans(input);
      planSnapshot = selectAuditedImage2Plan({ imagePlans: plans }, input.resolution);
    }
    await input.onPlanSelected?.(planSnapshot);
  } catch (error) {
    if (error instanceof ProviderSubmissionError) throw error;
    throw new ProviderSubmissionError(
      error instanceof Error ? error.message : "Unable to audit the Shuyu image plan",
      {
        providerId: "shuyu",
        stage: "preflight",
        retryable: true,
        cause: error,
      },
    );
  }
  const created = await createShuyuImageTask({
    ...input,
    providerRequestKey: input.requestKey,
    planId: planSnapshot.planId,
    model: planSnapshot.model,
    resolution: planSnapshot.resolution,
  });
  return {
    requestKey: input.requestKey,
    externalTaskId: created.taskId,
    planSnapshot,
  };
}

export async function pollShuyuImageTask(
  externalTaskId: string,
  options: ShuyuFetchOptions = {},
): Promise<ShuyuImageTaskResult> {
  if (mockImageRuntime()) {
    if (!externalTaskId.startsWith("mock_shuyu_image_")) {
      return {
        status: "failed",
        rawStatus: "refunded",
        outputUrls: [],
        errorMessage: "Dry-run refused to poll a real Shuyu image task",
      };
    }
    return {
      status: "succeeded",
      rawStatus: "completed",
      outputUrls: [`${MOCK_OUTPUT_PREFIX}${encodeURIComponent(externalTaskId)}.png`],
    };
  }
  const task = await getShuyuVideoTask(externalTaskId, options);
  if (task.status === "completed") {
    const outputUrls = task.outputs?.map((output) => output.url) ?? [];
    if (outputUrls.length === 0) {
      return {
        status: "failed",
        rawStatus: task.status,
        outputUrls: [],
        errorMessage: "Shuyu completed the task without an image output",
      };
    }
    return { status: "succeeded", rawStatus: task.status, outputUrls };
  }
  if (["failed", "refund_error", "refunded"].includes(task.status)) {
    return {
      status: "failed",
      rawStatus: task.status,
      outputUrls: [],
      errorMessage:
        task.status === "refunded"
          ? "Shuyu generation failed and provider points were refunded"
          : "Shuyu image generation failed",
    };
  }
  return {
    status: task.status === "queued" ? "queued" : "processing",
    rawStatus: task.status,
    outputUrls: [],
  };
}

export interface FetchShuyuOutputOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  allowedHosts?: string[];
}

function configuredOutputHosts(): string[] {
  const configured = process.env.SHUYU_OUTPUT_HOST_ALLOWLIST
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? configured : [...DEFAULT_OUTPUT_HOSTS];
}

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const candidate = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase();
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1);
      return candidate.endsWith(suffix) && candidate !== suffix.slice(1);
    }
    return candidate === allowed;
  });
}

export function validateShuyuOutputUrl(
  value: string,
  allowedHosts: readonly string[] = configuredOutputHosts(),
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Shuyu output URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !hostAllowed(url.hostname, allowedHosts)
  ) {
    throw new Error("Shuyu output destination is not allowed");
  }
  return url;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw abortError("Shuyu output fetch timed out");
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void reader.cancel().catch(() => undefined);
      reject(abortError("Shuyu output fetch timed out"));
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

export async function fetchShuyuOutputImage(
  value: string,
  options: FetchShuyuOutputOptions = {},
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (mockImageRuntime() && value.startsWith(MOCK_OUTPUT_PREFIX)) {
    return { bytes: Buffer.from(MOCK_IMAGE_BYTES), mimeType: "image/png" };
  }
  const url = validateShuyuOutputUrl(value, options.allowedHosts ?? configuredOutputHosts());
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES));
  const timeoutMs = Math.max(10, Math.min(options.timeoutMs ?? DEFAULT_OUTPUT_TIMEOUT_MS, 60_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "image/png,image/jpeg,image/webp" },
    });
    if (!response.ok || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Unable to read Shuyu output; redirects are not allowed");
    }
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!mimeType || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Shuyu output is not a supported image");
    }
    const contentLength = response.headers.get("content-length");
    const declaredLength = contentLength === null ? null : Number(contentLength);
    if (
      declaredLength !== null &&
      Number.isFinite(declaredLength) &&
      (declaredLength <= 0 || declaredLength > maxBytes)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Shuyu output image size is too large");
    }
    if (!response.body) throw new Error("Shuyu output image body is empty");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const chunk = await readChunk(reader, controller.signal);
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Shuyu output image size is too large");
      }
      chunks.push(chunk.value);
    }
    if (byteLength === 0) throw new Error("Shuyu output image body is empty");
    return { bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength), mimeType };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new Error("Shuyu output fetch timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (controller.signal.aborted && reader) {
      await reader.cancel().catch(() => undefined);
    }
    reader?.releaseLock();
  }
}
