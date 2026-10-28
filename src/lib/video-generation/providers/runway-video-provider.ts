/**
 * Runway 视频适配器（实现 VideoProvider；2026-10-28 商品主体轮，先写好等 key）。
 *
 * 只做请求编排 + 状态归一 + 错误分级；HTTP 细节在 src/lib/providers/runway.ts。
 * 还没挂进 video-route-registry：先用 scripts/runway-bakeoff.ts 跑小样对比，定了去留再挂成员工可选线路。
 * 挂线路时要一起补：路线 id 与适配器快照、按快照取适配器、运行就绪检查、产出地址转存（Runway 产出 24–48 小时过期）。
 *
 * 请求编排：
 * - seedance2_5 · reference（故事板路径：实拍 + 已确认关键帧都当参考）→ text_to_video，references 保持原顺序（≤30）；
 *   提示词里的「image N」序号与 references 顺序一致（与 Shuyu input_images 同一记法，真机待核实）。
 * - seedance2_5 · i2v → image_to_video，promptImage 取 first_frame / last_frame（没标角色就把第一张当首帧）；
 *   这条接口没有 references，多出来的图在提交前拒绝，不静默丢弃。
 * - klingO3_* → image_to_video：promptImage = 标了 first_frame（可选 last_frame）的图，其余进 references（≤7）；
 *   没标首帧就拒绝——故事板路径里实拍排在帧前面，拿第一张当首帧会让成片从白底商品图开场。
 * 负面提示词没有独立字段，按「Negative constraints:」并进提示词（与 Shuyu / BytePlus 同一写法）。
 */

import {
  cancelRunwayTask,
  createRunwayTask,
  getRunwayTask,
  RUNWAY_MODEL_LIMITS,
  runwayApiKey,
  RunwayApiError,
  runwayRatio,
  type RunwayFetchOptions,
  type RunwayPromptImage,
  type RunwayVideoModel,
  type RunwayVideoRequest,
} from "@/lib/providers/runway";
import { asProviderSubmissionError, ProviderSubmissionError } from "./submission-error";
import type {
  CreateVideoJobOptions,
  CreateVideoJobResult,
  NormalizedVideoStatus,
  VideoJobStatusResult,
  VideoProvider,
} from "./types";
import { normalizeStatusBuiltin } from "./types";

const PROVIDER_ID = "runway" as const;

function preflight(message: string): ProviderSubmissionError {
  return new ProviderSubmissionError(message, { providerId: PROVIDER_ID, stage: "preflight", retryable: false });
}

function uniqueUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
}

/**
 * 把一次视频任务编排成 Runway 请求（纯函数：适配器与小样对比脚本共用）。不合法时抛 preflight 错误（一定没建任务）。
 */
export function buildRunwayVideoRequest(options: CreateVideoJobOptions, model: RunwayVideoModel): RunwayVideoRequest {
  const limits = RUNWAY_MODEL_LIMITS[model];
  const promptText = options.negativePrompt?.trim()
    ? `${options.prompt}\nNegative constraints: ${options.negativePrompt.trim()}`
    : options.prompt;
  if (!promptText.trim()) throw preflight("Runway 提示词不能为空");
  if (limits.promptMax !== null && promptText.length > limits.promptMax) {
    throw preflight(`Runway ${model} 提示词最多 ${limits.promptMax} 字（含负面约束），现在 ${promptText.length} 字`);
  }
  const duration = options.durationSec ?? 5;
  if (!Number.isInteger(duration) || duration < limits.minDuration || duration > limits.maxDuration) {
    throw preflight(`Runway ${model} 时长必须是 ${limits.minDuration}–${limits.maxDuration} 秒的整数`);
  }
  const ratio = runwayRatio(model, options.aspectRatio ?? "9:16", options.resolution);
  if (!ratio) throw preflight(`Runway 只接 9:16 / 16:9 / 1:1，收到 ${options.aspectRatio}`);
  if ((options.referenceVideos?.length ?? 0) > 0 || (options.referenceAudios?.length ?? 0) > 0) {
    throw preflight("Runway 适配器还没接参考视频 / 参考音频");
  }
  const seed = Number.isInteger(options.seed) ? options.seed : undefined;
  const images = options.referenceImages ?? [];
  const first = images.find((image) => image.role === "first_frame")?.url.trim() || null;
  const last = images.find((image) => image.role === "last_frame")?.url.trim() || null;
  const frameUrls = new Set([first, last].filter((url): url is string => Boolean(url)));
  const promptImages = (firstUrl: string | null, lastUrl: string | null): RunwayPromptImage[] => [
    ...(firstUrl ? [{ uri: firstUrl, position: "first" as const }] : []),
    ...(lastUrl ? [{ uri: lastUrl, position: "last" as const }] : []),
  ];

  if (model === "seedance2_5") {
    if (options.referenceMode === "i2v") {
      const all = uniqueUrls(images.map((image) => image.url));
      const firstUrl = first ?? all[0] ?? null;
      if (!firstUrl) throw preflight("Runway seedance2_5 图生视频需要一张首帧");
      const extra = all.filter((url) => url !== firstUrl && url !== last);
      if (extra.length > 0) {
        throw preflight(`Runway seedance2_5 图生视频只收首尾帧，另外 ${extra.length} 张参考图请改用参考模式`);
      }
      return {
        endpoint: "/v1/image_to_video",
        body: {
          model,
          promptImage: promptImages(firstUrl, last),
          promptText,
          ratio,
          duration,
          audio: options.generateAudio ?? true,
          ...(seed === undefined ? {} : { seed }),
        },
      };
    }
    const references = uniqueUrls(images.map((image) => image.url));
    if (references.length > limits.referencesMax) {
      throw preflight(`Runway seedance2_5 最多 ${limits.referencesMax} 张参考图，收到 ${references.length} 张`);
    }
    return {
      endpoint: "/v1/text_to_video",
      body: {
        model,
        promptText,
        ratio,
        duration,
        audio: options.generateAudio ?? true,
        ...(references.length > 0 ? { references: references.map((uri) => ({ uri })) } : {}),
        ...(seed === undefined ? {} : { seed }),
      },
    };
  }

  if (!first) {
    throw preflight(`Runway ${model} 需要一张标了 first_frame 的首帧（故事板路径里取第一张关键帧）`);
  }
  const references = uniqueUrls(images.map((image) => image.url)).filter((url) => !frameUrls.has(url));
  if (references.length > limits.referencesMax) {
    throw preflight(`Runway ${model} 除首尾帧外最多 ${limits.referencesMax} 张参考图，收到 ${references.length} 张`);
  }
  return {
    endpoint: "/v1/image_to_video",
    body: {
      model,
      promptImage: promptImages(first, last),
      promptText,
      ratio,
      duration,
      ...(options.generateAudio === undefined ? {} : { audio: options.generateAudio }),
      ...(references.length > 0 ? { references: references.map((uri) => ({ uri })) } : {}),
      ...(seed === undefined ? {} : { seed }),
    },
  };
}

/** Runway 任务状态 → 统一 6 态（THROTTLED = 账户并发满了在排队） */
export function normalizeRunwayStatus(raw: string): NormalizedVideoStatus {
  switch (raw.trim().toUpperCase()) {
    case "PENDING":
    case "THROTTLED":
      return "queued";
    case "RUNNING":
      return "processing";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return normalizeStatusBuiltin(raw);
  }
}

/**
 * 提交失败分级（submission-error 的保守口径）：
 * - 4xx（含 429）= 请求在建任务之前就被拒，一定没建；只有 429 值得原样重试；
 * - 5xx、超时、网络断、200 却没有任务 id = 不确定是否已建，不自动重放。
 */
function submissionError(error: unknown): ProviderSubmissionError {
  if (!(error instanceof RunwayApiError)) return asProviderSubmissionError({ error, providerId: PROVIDER_ID });
  if (error.status >= 400 && error.status < 500) {
    return new ProviderSubmissionError(error.message, {
      providerId: PROVIDER_ID,
      stage: "provider_response",
      httpStatus: error.status,
      providerConfirmedNoJob: true,
      retryable: error.status === 429,
      cause: error,
    });
  }
  return new ProviderSubmissionError(error.message, {
    providerId: PROVIDER_ID,
    stage: error.status === 0 ? "transport" : error.status === 200 ? "response_decode" : "provider_response",
    ...(error.status > 0 ? { httpStatus: error.status } : {}),
    retryable: false,
    cause: error,
  });
}

export class RunwayVideoProvider implements VideoProvider {
  readonly id = PROVIDER_ID;
  readonly displayName = "Runway API";
  readonly manualRetryBillingRisk = "possible" as const;
  /// Runway 的 seedance2_5 收参考音频，但这里的 wire 层还没接（接之前提交前拒绝）
  readonly supportsReferenceAudio = false;
  readonly maxReferenceImages: number;

  constructor(
    readonly model: RunwayVideoModel = "seedance2_5",
    private readonly fetchOptions: RunwayFetchOptions = {},
  ) {
    this.maxReferenceImages = RUNWAY_MODEL_LIMITS[model].referencesMax;
  }

  isConfigured(): boolean {
    return Boolean(runwayApiKey(this.fetchOptions.env));
  }

  isMockMode(): boolean {
    return false;
  }

  async createVideoJob(options: CreateVideoJobOptions): Promise<CreateVideoJobResult> {
    if (!this.isConfigured()) throw preflight("Runway 未配置：缺少 RUNWAYML_API_SECRET");
    if (options.model && options.model !== this.model) {
      throw preflight(`Runway 适配器绑定的是 ${this.model}，请求要的是 ${options.model}`);
    }
    const request = buildRunwayVideoRequest(options, this.model);
    try {
      const task = await createRunwayTask(request, this.fetchOptions);
      return { providerJobId: task.id, providerId: this.id };
    } catch (error) {
      throw submissionError(error);
    }
  }

  async getVideoJobStatus(providerJobId: string): Promise<VideoJobStatusResult> {
    const task = await getRunwayTask(providerJobId, this.fetchOptions);
    const normalizedStatus = this.normalizeProviderStatus(task.status);
    const videoUrl = task.output?.[0];
    return {
      providerJobId: task.id,
      normalizedStatus: normalizedStatus === "succeeded" && !videoUrl ? "failed" : normalizedStatus,
      rawProviderStatus: task.status,
      ...(videoUrl ? { videoUrl } : {}),
      ...(task.status === "FAILED"
        ? { errorMessage: `${task.failure ?? "Runway 任务失败"}${task.failureCode ? `（${task.failureCode}）` : ""}` }
        : normalizedStatus === "succeeded" && !videoUrl
          ? { errorMessage: "Runway 任务成功但没有返回视频地址" }
          : {}),
      /// RUNNING 的 progress 是 0–1 小数，这里统一成 0–100
      ...(typeof task.progress === "number"
        ? { progress: Math.round((task.progress <= 1 ? task.progress * 100 : task.progress) * 10) / 10 }
        : {}),
      rawProviderResponse: task,
    };
  }

  async cancelVideoJob(providerJobId: string): Promise<{ supported: boolean; cancelled?: boolean; error?: string }> {
    try {
      await cancelRunwayTask(providerJobId, this.fetchOptions);
      return { supported: true, cancelled: true };
    } catch (error) {
      return { supported: true, cancelled: false, error: (error as Error).message };
    }
  }

  getGeneratedVideoUrl(status: VideoJobStatusResult): string | null {
    return status.videoUrl ?? null;
  }

  normalizeProviderStatus(raw: string): NormalizedVideoStatus {
    return normalizeRunwayStatus(raw);
  }
}
