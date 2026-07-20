/**
 * Seedance 视频生成 Provider（BytePlus international + explicit legacy CN）
 *
 * Mock 模式：默认模式，或 VIDEO_ENGINE_MOCK=true
 * Real 模式：仅在 VIDEO_ENGINE_MOCK=false 且所选 runtime profile 配置完整时启用
 *
 * API 文档: https://docs.byteplus.com/en/docs/ModelArk/1520757
 *   POST /contents/generations/tasks        (提交)
 *   GET  /contents/generations/tasks/{id}   (查询)
 *
 * 设计要点（Phase Lifecycle Hardening · 2026-05）：
 * - 状态结果必须额外携带 rawProviderStatus，供调和层做决策（不要丢掉原始字符串）。
 * - getStatusReal 永远不抛出非业务异常—网络/解析问题统一抛 Error，
 *   方便调和函数把它当成「轮询失败、未到终态」处理而不是误终结任务。
 * - 所有对外 fetch 必须带显式超时（INV-3，2026-07 卡死事故加固）：
 *   SEEDANCE_HTTP_TIMEOUT_MS 可配置，默认 30s。超时抛带 "timeout" 字样的 Error。
 * - webhook 回调通道已删除（2026-07）：此前 SEEDANCE_CALLBACK_URL 只在提交时
 *   携带，仓库里从未有接收路由，是假通道。回调留到下一轮作为独立功能实现。
 */

import { isDryRun } from "@/lib/config/dry-run";
import { assertMockVideoRuntimeAllowed } from "@/lib/config/env";
import {
  BYTEPLUS_ARK_BASE_URL,
  VOLCENGINE_CN_ARK_BASE_URL,
  resolveSeedanceArkBaseUrl,
  resolveSeedanceRuntimeProfile,
  seedanceApiKey,
  seedanceCredentialEnvName,
  seedanceDefaultModel,
  seedanceRuntimeProviderId,
  type SeedanceRuntimeProfile,
} from "@/lib/config/seedance-runtime";
import { ProviderSubmissionError } from "@/lib/video-generation/providers/submission-error";

export { BYTEPLUS_ARK_BASE_URL, VOLCENGINE_CN_ARK_BASE_URL };

export interface SeedanceSubmitOptions {
  prompt: string;
  /**
   * I2V 时的参考图 URL。如果提供，会作为 first_frame 传给模型。
   * 支持 1-5 张；第 2 张以后会作为 last_frame 或内容辅助（按顺序）。
   */
  referenceImageUrls?: string[];
  /**
   * 生成模式（Seedance 2.0）：
   * - 不传 / "i2v"  → 既有行为：第 1 张 referenceImageUrls 作 first_frame、第 2 张作 last_frame；
   * - "reference"   → 多模态参考生视频（Omni-Reference）：referenceImageUrls 全部以
   *                   `role: reference_image` 注入（最多 9 张），prompt 里用「图片1/图片2」按
   *                   顺序引用。与 first_frame/last_frame 互斥，用于数字人/主体跨镜头一致性。
   *
   * 仅 Seedance 2 模型支持 reference；Seedance-1 会忽略并按 first_frame 处理。
   */
  mode?: "i2v" | "reference";
  duration?: number;
  resolution?: string;
  ratio?: string;
  model?: string;
  returnLastFrame?: boolean;
  /**
   * Seedance 2 only。是否要求模型生成原生音频。
   * 默认 `true`（与 wrapper 既有行为一致；不传不会破坏现网调用）。
   * 设为 `false` 时会在请求体里显式带 `generate_audio: false`，适合
   * 投资人 demo 这类「后期会铺自家音乐床或干脆静音」的场景，避免 5 段
   * 段间 ambience 不一致拉低质感。Seedance-1 模型不存在该字段，会被忽略。
   */
  generateAudio?: boolean;
  /**
   * 仅在 VIDEO_ENGINE_MOCK=true 时生效；real Seedance payload 永远不会包含此字段。
   * 用于让 mock 路径渲染出「每段都不一样、肉眼可辨、可拼接」的占位 MP4。
   */
  mockHints?: {
    briefId: string;
    segmentIndex: number;
    segmentCount: number;
    durationSec: number;
    aspectRatio: string;
    purpose?: string;
  };
}

export type SeedanceStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface SeedanceJobResult {
  jobId: string;
  /// 我们规约后的 4 态
  status: SeedanceStatus;
  /// Provider 原始状态字符串：queued / running / succeeded / failed / expired / cancelled / ...
  rawProviderStatus: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  lastFrameUrl?: string;
  errorMessage?: string;
  progress?: number;
  /// 完整 Provider 响应（仅 admin/debug 区使用，不要直接展示给客户）
  rawProviderResponse?: unknown;
}

/**
 * Persistable routing snapshot for one provider job. It intentionally excludes
 * credentials: callers may store this value with the job and reconstruct the
 * same provider route after a global default switch without persisting a key.
 */
export type SeedanceRuntimeSnapshot = Readonly<{
  profile: SeedanceRuntimeProfile;
  providerId: ReturnType<typeof seedanceRuntimeProviderId>;
  baseUrl: string;
  model: string;
}>;

export function createSeedanceRuntimeSnapshot(args: {
  profile: SeedanceRuntimeProfile;
  model?: string;
  baseUrl?: string;
}): SeedanceRuntimeSnapshot {
  const profile = resolveSeedanceRuntimeProfile(args.profile);
  const model = (args.model || seedanceDefaultModel(profile)).trim();
  if (!model || model.length > 200) {
    throw new Error("Seedance runtime snapshot model 无效");
  }
  return Object.freeze({
    profile,
    providerId: seedanceRuntimeProviderId(profile),
    baseUrl: resolveSeedanceArkBaseUrl(args.baseUrl, profile),
    model,
  });
}

type MockJobRecord = {
  status: string;
  createdAt: number;
  prompt: string;
  mockHints?: SeedanceSubmitOptions["mockHints"];
};

const mockJobs = new Map<string, MockJobRecord>();

const MOCK_PROCESSING_TIME_MS = Number(
  process.env.VIDEO_ENGINE_MOCK_LATENCY_MS ?? "1500",
);

/// 对外 HTTP 显式超时（INV-3）：请求悬挂时抛错走「轮询失败」路径，绝不无限等待
function seedanceHttpTimeoutMs(): number {
  return Number(process.env.SEEDANCE_HTTP_TIMEOUT_MS ?? "30000");
}

/**
 * Backward-compatible public helper for callers/tests that explicitly audit
 * the BytePlus international endpoint. Runtime requests use the selected
 * profile through an immutable runtime snapshot.
 */
export function resolveBytePlusArkBaseUrl(
  raw = process.env.ARK_BASE_URL,
): string {
  return resolveSeedanceArkBaseUrl(raw, "byteplus_international");
}

export function resolveVolcengineLegacyArkBaseUrl(
  raw = process.env.ARK_BASE_URL,
): string {
  return resolveSeedanceArkBaseUrl(raw, "volcengine_cn_legacy");
}

function selectedRuntimeProfile(): SeedanceRuntimeProfile {
  return resolveSeedanceRuntimeProfile(process.env.SEEDANCE_RUNTIME_PROFILE);
}

function globalRuntimeSnapshot(model?: string): SeedanceRuntimeSnapshot {
  const profile = selectedRuntimeProfile();
  return createSeedanceRuntimeSnapshot({
    profile,
    baseUrl: process.env.ARK_BASE_URL,
    model: model || process.env.ARK_VIDEO_MODEL,
  });
}

function requireSelectedApiKey(
  profile: SeedanceRuntimeProfile,
  action: "调用" | "查询",
): string {
  const apiKey = seedanceApiKey(profile);
  if (apiKey) return apiKey;
  const credentialName = seedanceCredentialEnvName(profile);
  throw new Error(
    `Seedance 真实模式已开启（VIDEO_ENGINE_MOCK=false），但 ${credentialName} 未配置（runtime profile: ${profile}）；拒绝真实${action}。`,
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(seedanceHttpTimeoutMs()),
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") {
      throw new Error(
        `Seedance ${label} timeout: 超过 ${seedanceHttpTimeoutMs()}ms 未响应`,
      );
    }
    throw err;
  }
}

/**
 * Mock 模式判定（Phase 2 收紧）：
 *   - VIDEO_ENGINE_MOCK 显式 true/1/yes  → mock
 *   - VIDEO_ENGINE_MOCK 显式 false/0/no  → real（即便 BYTEPLUS_ARK_API_KEY 缺失也走 real，
 *       让 submitReal/getStatusReal 抛清晰错误，避免 silent fall-back to mock 导致
 *       生产误以为「在跑真实任务」）
 *   - 未设置                              → 一律 mock（真实调用必须显式解锁）
 */
function isMockMode(): boolean {
  if (isDryRun()) return true;
  const flag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return true;
}

export function isSeedanceConfigured(): boolean {
  return isSeedanceRuntimeConfigured();
}

export function isSeedanceRuntimeConfigured(
  runtime?: SeedanceRuntimeSnapshot,
): boolean {
  if (!runtime && isMockMode()) return false;
  try {
    const selected = runtime
      ? normalizeRuntimeSnapshot(runtime)
      : globalRuntimeSnapshot();
    return !!seedanceApiKey(selected.profile);
  } catch {
    return false;
  }
}

export async function submitSeedanceJob(
  options: SeedanceSubmitOptions,
  runtime?: SeedanceRuntimeSnapshot,
): Promise<{ jobId: string }> {
  if (!runtime && isMockMode()) {
    assertMockVideoRuntimeAllowed();
    return submitMock(options);
  }
  const selected = runtime
    ? normalizeRuntimeSnapshot(runtime)
    : globalRuntimeSnapshot(options.model);
  assertRuntimeModelMatchesOption(options, selected);
  return submitReal(options, selected);
}

/** Seedance I2V first_frame blocked for photorealistic persons / privacy. */
export function isSeedancePrivacyBlockError(message: string): boolean {
  return /SensitiveContent|real person|PrivacyInformation/i.test(message);
}

/**
 * Submit to Seedance; on I2V privacy rejection, retry once as T2V (no reference images).
 */
export async function submitSeedanceJobResilient(
  options: SeedanceSubmitOptions,
  runtime?: SeedanceRuntimeSnapshot,
): Promise<{ jobId: string }> {
  const { reviewTextOrThrow } = await import("@/lib/content-review");
  await reviewTextOrThrow({
    kind: "generation_prompt",
    text: options.prompt,
  });
  const hadRef = (options.referenceImageUrls?.filter(Boolean).length ?? 0) > 0;
  try {
    return await submitSeedanceJob(options, runtime);
  } catch (err) {
    const msg = (err as Error).message;
    if (hadRef && isSeedancePrivacyBlockError(msg)) {
      return submitSeedanceJob(
        {
          ...options,
          referenceImageUrls: undefined,
        },
        runtime,
      );
    }
    throw err;
  }
}

export async function getSeedanceStatus(
  jobId: string,
  runtime?: SeedanceRuntimeSnapshot,
): Promise<SeedanceJobResult> {
  if (jobId.startsWith("mock_") || (!runtime && isMockMode())) {
    assertMockVideoRuntimeAllowed();
    return getStatusMock(jobId);
  }
  return getStatusReal(
    jobId,
    runtime ? normalizeRuntimeSnapshot(runtime) : globalRuntimeSnapshot(),
  );
}

/**
 * Adapter bound to one immutable route. Service/API layers can reconstruct it
 * from a stored runtime snapshot without branching on provider-specific env.
 */
export class SeedanceRuntimeAdapter {
  readonly runtimeSnapshot: SeedanceRuntimeSnapshot;
  readonly id: SeedanceRuntimeSnapshot["providerId"];

  constructor(
    profile: SeedanceRuntimeProfile,
    model?: string,
    baseUrl?: string,
  ) {
    this.runtimeSnapshot = createSeedanceRuntimeSnapshot({
      profile,
      model,
      baseUrl,
    });
    this.id = this.runtimeSnapshot.providerId;
  }

  isConfigured(): boolean {
    return isSeedanceRuntimeConfigured(this.runtimeSnapshot);
  }

  submit(options: SeedanceSubmitOptions): Promise<{ jobId: string }> {
    return submitSeedanceJob(options, this.runtimeSnapshot);
  }

  submitResilient(
    options: SeedanceSubmitOptions,
  ): Promise<{ jobId: string }> {
    return submitSeedanceJobResilient(options, this.runtimeSnapshot);
  }

  getStatus(jobId: string): Promise<SeedanceJobResult> {
    return getSeedanceStatus(jobId, this.runtimeSnapshot);
  }
}

function assertRuntimeModelMatchesOption(
  options: SeedanceSubmitOptions,
  runtime: SeedanceRuntimeSnapshot,
): void {
  const optionModel = options.model?.trim();
  if (optionModel && optionModel !== runtime.model) {
    throw new ProviderSubmissionError(
      "Seedance 请求模型与持久化 runtime snapshot 不一致",
      {
        providerId: runtime.providerId,
        stage: "preflight",
        retryable: false,
      },
    );
  }
}

function normalizeRuntimeSnapshot(
  runtime: SeedanceRuntimeSnapshot,
): SeedanceRuntimeSnapshot {
  return createSeedanceRuntimeSnapshot({
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    model: runtime.model,
  });
}

function submitMock(options: SeedanceSubmitOptions): { jobId: string } {
  const jobId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  mockJobs.set(jobId, {
    status: "processing",
    createdAt: Date.now(),
    prompt: options.prompt,
    mockHints: options.mockHints,
  });
  if (options.mockHints) {
    console.log(
      `[seedance:mock] 提交任务: ${jobId} (seg ${
        options.mockHints.segmentIndex + 1
      }/${options.mockHints.segmentCount}, ${options.mockHints.durationSec}s, ${options.mockHints.aspectRatio})`,
    );
  } else {
    console.log(`[seedance:mock] 提交任务: ${jobId}`);
  }
  return { jobId };
}

/**
 * Dev mock：Next.js HMR 会清空进程内 mockJobs。按 externalJobId 从 DB 恢复 hints，
 * 避免轮询误判「任务不存在」→ 整单 RENDER_FAILED。
 */
async function recoverMockJobRecord(jobId: string): Promise<MockJobRecord | null> {
  if (!jobId.startsWith("mock_")) return null;
  try {
    const { db } = await import("@/lib/db");
    const row = await db.videoJob.findFirst({
      where: { externalJobId: jobId },
      select: {
        videoBriefId: true,
        segmentIndex: true,
        segmentDurationSec: true,
        submittedAt: true,
        startedAt: true,
        videoBrief: {
          select: {
            aspectRatio: true,
            finalVideo: { select: { segmentCount: true } },
          },
        },
      },
    });
    if (
      !row ||
      row.segmentIndex == null ||
      row.videoBriefId == null ||
      row.videoBrief == null
    ) {
      return null;
    }
    const segmentCount = row.videoBrief.finalVideo?.segmentCount ?? 1;
    return {
      status: "processing",
      createdAt: (row.submittedAt ?? row.startedAt ?? new Date()).getTime(),
      prompt: "",
      mockHints: {
        briefId: row.videoBriefId,
        segmentIndex: row.segmentIndex,
        segmentCount,
        durationSec: row.segmentDurationSec ?? 15,
        aspectRatio: row.videoBrief.aspectRatio ?? "9:16",
      },
    };
  } catch {
    return null;
  }
}

async function getStatusMock(jobId: string): Promise<SeedanceJobResult> {
  let job = mockJobs.get(jobId);
  if (!job) {
    const recovered = await recoverMockJobRecord(jobId);
    if (recovered) {
      job = recovered;
      mockJobs.set(jobId, recovered);
    }
  }
  if (!job) {
    return {
      jobId,
      status: "failed",
      rawProviderStatus: "not_found",
      errorMessage: "Mock 任务不存在",
    };
  }
  const elapsed = Date.now() - job.createdAt;
  if (elapsed < MOCK_PROCESSING_TIME_MS) {
    return {
      jobId,
      status: "processing",
      rawProviderStatus: "running",
      progress: Math.min(95, Math.floor((elapsed / MOCK_PROCESSING_TIME_MS) * 100)),
    };
  }

  /// 优先用 mockHints 渲染唯一可拼接 MP4；缺失则回退到通用 9:16 静态占位
  const fallbackHints: NonNullable<SeedanceSubmitOptions["mockHints"]> = {
    briefId: "unknown",
    segmentIndex: 0,
    segmentCount: 1,
    durationSec: 5,
    aspectRatio: "9:16",
    purpose: "fallback",
  };
  const hints = job.mockHints ?? fallbackHints;
  let videoUrl: string;
  try {
    const configuredFixture = process.env.MOCK_OUTPUT_VIDEO_URL?.trim();
    if (configuredFixture) {
      const parsed = new URL(configuredFixture);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("MOCK_OUTPUT_VIDEO_URL 必须是 http(s) URL");
      }
      videoUrl = parsed.toString();
    } else {
      const { generateMockClip } = await import(
        "@/lib/video-generation/mock-clip-generator"
      );
      const clip = await generateMockClip(hints);
      videoUrl = clip.url;
    }
  } catch (err) {
    /// 渲染失败：返回 failed 让上层走重试 / 用户可见错误，不要 silent fall back to bunny URL
    return {
      jobId,
      status: "failed",
      rawProviderStatus: "mock_render_failed",
      errorMessage: `Mock 视频渲染失败: ${(err as Error).message}`,
    };
  }
  mockJobs.delete(jobId);
  return {
    jobId,
    status: "completed",
    rawProviderStatus: "succeeded",
    videoUrl,
    thumbnailUrl: undefined,
    progress: 100,
  };
}

async function submitReal(
  options: SeedanceSubmitOptions,
  runtime: SeedanceRuntimeSnapshot,
): Promise<{ jobId: string }> {
  const profile = runtime.profile;
  const apiKey = requireSelectedApiKey(profile, "调用");
  const baseUrl = runtime.baseUrl;
  const providerId = seedanceRuntimeProviderId(profile);
  const model = runtime.model;

  const isSeedance2 = model.includes("seedance-2");

  /// Seedance 2.0 官方建议英文 ≤1000 词（约 6000 字符）；多分镜时间轴 prompt 通常 2500-3300 字符。
  /// Seedance 1.x 维持旧 2000 上限。
  const MAX = isSeedance2 ? 4000 : 2000;
  const promptText =
    options.prompt.length > MAX
      ? options.prompt.slice(0, MAX).replace(/\s\S*$/, "")
      : options.prompt;
  const images = options.referenceImageUrls?.filter(Boolean) ?? [];
  /// reference 模式仅在 Seedance 2 上有意义（多模态参考生视频）。
  const useReferenceMode = options.mode === "reference" && isSeedance2;

  type ContentPart =
    | {
        type: "image_url";
        image_url:
          | string
          | { url: string; role?: "first_frame" | "last_frame" };
        /// Seedance 2.0 多模态参考：role 作为 content item 的同级字段（官方原生格式）。
        /// 火山 CN 端点对 first/last frame 也要求同级 role（见下方注释）。
        role?: "reference_image" | "first_frame" | "last_frame";
      }
    | { type: "text"; text: string };
  const content: ContentPart[] = [];

  if (useReferenceMode) {
    /// 最多 9 张 reference_image（Omni-Reference）；role 为 content item 同级字段。
    for (const url of images.slice(0, 9)) {
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
    }
  } else {
    /// 火山 CN 端点（volcengine_cn_legacy）要求 first/last frame 的 role 是
    /// content item 同级字段：image_url 内嵌 role 会被 InvalidParameter
    /// "role must be specified for image contents" 拒绝（2026-07-20 真机验收实测）。
    /// BytePlus intl 维持既有 image_url.role 内嵌格式不动，避免破坏已验证线路。
    const roleAsSibling = isSeedance2 && profile === "volcengine_cn_legacy";
    if (images[0]) {
      if (roleAsSibling) {
        content.push({
          type: "image_url",
          image_url: { url: images[0] },
          role: "first_frame",
        });
      } else {
        content.push({
          type: "image_url",
          image_url: isSeedance2
            ? { url: images[0], role: "first_frame" }
            : images[0],
        });
      }
    }
    if (isSeedance2 && images[1]) {
      if (roleAsSibling) {
        content.push({
          type: "image_url",
          image_url: { url: images[1] },
          role: "last_frame",
        });
      } else {
        content.push({
          type: "image_url",
          image_url: { url: images[1], role: "last_frame" },
        });
      }
    }
  }
  content.push({ type: "text", text: promptText });

  const body: Record<string, unknown> = {
    model,
    content,
    ratio: options.ratio || "9:16",
    duration: options.duration || 15,
    watermark: false,
  };
  if (isSeedance2) {
    /// 默认 true 保持向后兼容（旧调用方不传该字段时，原本就硬编码 true）；
    /// 显式传 false 才关闭，便于投资人 demo 用静音 + 自家音乐床。
    body.generate_audio = options.generateAudio ?? true;
    if (options.returnLastFrame) body.return_last_frame = true;
    /// Seedance 2.0 支持 resolution（720p/1080p）；仅在显式提供时下发，避免改动既有默认行为。
    if (options.resolution) body.resolution = options.resolution;
  } else {
    body.resolution = options.resolution || "1080p";
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${baseUrl}/contents/generations/tasks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      "提交",
    );
  } catch (cause) {
    throw new ProviderSubmissionError("Seedance 提交传输失败", {
      providerId,
      stage: "transport",
      retryable: false,
      cause,
    });
  }

  if (!res.ok) {
    const code = await readSafeProviderErrorCode(res);
    const message = `Seedance 提交被 provider 拒绝: HTTP ${res.status}${code ? ` (${code})` : ""}`;
    throw new ProviderSubmissionError(message, {
      providerId,
      stage: "provider_response",
      httpStatus: res.status,
      code,
      // Only authentication rejection is positive evidence that BytePlus did
      // not create a billable task. Other 4xx responses (notably 408/409/429)
      // can be emitted after an upstream accepted the request, so they remain
      // acknowledgement-unknown until the provider contract proves otherwise.
      providerConfirmedNoJob: res.status === 401 || res.status === 403,
      retryable: false,
    });
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (cause) {
    throw new ProviderSubmissionError("Seedance 成功响应无法解码", {
      providerId,
      stage: "response_decode",
      httpStatus: res.status,
      retryable: false,
      cause,
    });
  }
  const record =
    data != null && typeof data === "object"
      ? (data as Record<string, unknown>)
      : null;
  const taskId =
    typeof record?.id === "string"
      ? record.id
      : typeof record?.task_id === "string"
        ? record.task_id
        : null;
  if (!taskId) {
    throw new ProviderSubmissionError("Seedance 成功响应未携带任务 ID", {
      providerId,
      stage: "response_decode",
      httpStatus: res.status,
      retryable: false,
    });
  }
  return { jobId: taskId };
}

async function readSafeProviderErrorCode(
  response: Response,
): Promise<string | undefined> {
  const raw = await response.text().catch(() => "");
  if (!raw) return undefined;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (payload == null || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  const nestedError =
    record.error != null && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : null;
  const candidates = [
    nestedError?.code,
    nestedError?.type,
    record.code,
    record.error_code,
  ];
  const code = candidates.find((value): value is string =>
    typeof value === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(value),
  );
  return code;
}

async function getStatusReal(
  jobId: string,
  runtime: SeedanceRuntimeSnapshot,
): Promise<SeedanceJobResult> {
  const profile = runtime.profile;
  const apiKey = requireSelectedApiKey(profile, "查询");
  const baseUrl = runtime.baseUrl;

  const res = await fetchWithTimeout(
    `${baseUrl}/contents/generations/tasks/${jobId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    "查询",
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Seedance 查询失败: ${res.status} ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const rawStatus: string = typeof data.status === "string" ? data.status : "unknown";

  /// Provider 真实进度（0-100）。Ark 部分模型/版本在任务体里带 progress；
  /// 缺失时返回 undefined，调和层保持 lastProgress 不变、UI 走阶段估算。
  const rawProgress =
    typeof data.progress === "number"
      ? data.progress
      : typeof data.content?.progress === "number"
        ? data.content.progress
        : undefined;

  return {
    jobId,
    status: mapProviderStatus(rawStatus),
    rawProviderStatus: rawStatus,
    progress: rawProgress,
    videoUrl: data.content?.video_url || data.video_url,
    thumbnailUrl: data.content?.cover_url || data.thumbnail_url,
    lastFrameUrl: data.content?.last_frame_url || data.last_frame_url,
    errorMessage: isFailureStatus(rawStatus)
      ? data.error?.message ||
        data.error?.code ||
        `Seedance 视频生成失败 (${rawStatus})`
      : undefined,
    rawProviderResponse: data,
  };
}

/// Provider 原始状态映射：保留所有可能的字符串，未知字符串归到 processing 以避免误终结
function mapProviderStatus(raw: string): SeedanceStatus {
  const normalized = raw.toLowerCase();
  if (["succeeded", "success", "completed", "done"].includes(normalized)) {
    return "completed";
  }
  if (["failed", "error", "expired", "cancelled", "canceled"].includes(normalized)) {
    return "failed";
  }
  if (["queued", "pending", "waiting"].includes(normalized)) {
    return "pending";
  }
  /// running / processing / unknown → 都视作仍在生成
  return "processing";
}

function isFailureStatus(raw: string): boolean {
  return ["failed", "error", "expired", "cancelled", "canceled"].includes(
    raw.toLowerCase(),
  );
}

/// 仅供测试导入：纯函数版本的状态映射
export const __test__ = { mapProviderStatus, isFailureStatus };
