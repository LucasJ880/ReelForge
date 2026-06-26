/**
 * 火山引擎 OmniHuman 数字人「单图 + 音频 → 对口型视频」Provider
 * ==================================================================
 *
 * 走的是火山引擎「智能视觉服务（CV / Visual）」，与 Ark（大模型推理）、
 * 火山 TTS（语音合成）都是**不同的服务和鉴权体系**：
 *
 *   - Endpoint:  https://visual.volcengineapi.com
 *   - 协议:      火山引擎 OpenAPI 签名 V4（HMAC-SHA256，service=cv，region=cn-north-1）
 *   - 鉴权:      主账号 / 子账号 AccessKeyId + SecretAccessKey
 *                （复用本仓库 TOS 一致的 VOLCENGINE_ACCESS_KEY_ID / _SECRET_ACCESS_KEY）
 *   - 调用:      异步任务 —— CVSync2AsyncSubmitTask（提交）+ CVSync2AsyncGetResult（轮询）
 *
 * 输入约束（火山硬性要求）：
 *   - image_url / audio_url **必须是公网可直接下载的 URL**（不能是内网 / 需要鉴权的私链）。
 *     本仓库用 storage provider（TOS / Vercel Blob）上传成公网 URL。
 *   - 图建议：清晰正脸人像；音频建议 ≤ 60s。
 *
 * req_key（算法名）：不同账号开通的 OmniHuman 版本取值不同（1.0 quick / 1.5 等），
 *   所以做成 env 可配（VOLC_OMNIHUMAN_REQ_KEY），默认给 OmniHuman 视频生成的常见值。
 *   ⚠ 跑真实任务前，请在火山控制台「智能视觉服务 → OmniHuman → 调用步骤2:视频生成」
 *     或 API Explorer 里核对你账号实际的 req_key，并在 .env.local 覆盖。
 *
 * 文档：https://www.volcengine.com/docs/85128（智能视觉服务 → 视频生成 → OmniHuman）
 */

import { createHash, createHmac } from "node:crypto";

const DEFAULT_HOST = "visual.volcengineapi.com";
const DEFAULT_REGION = "cn-north-1";
const DEFAULT_SERVICE = "cv";
const DEFAULT_VERSION = "2022-08-31";
/// OmniHuman 视频生成算法名（按账号开通版本可能不同，可用 env 覆盖）。
const DEFAULT_REQ_KEY = "realman_avatar_picture_omni_v2";

export type OmniHumanStatus = "pending" | "processing" | "completed" | "failed";

export interface OmniHumanSubmitOptions {
  /// 数字人形象图（公网可达 URL，清晰正脸）
  imageUrl: string;
  /// 驱动音频（公网可达 URL，mp3 / wav，建议 ≤ 60s）
  audioUrl: string;
  /// 可选：控制表情 / 稳定性 / 风格的文本提示
  prompt?: string;
  /// 可选：主体 mask（多人图时先做主体检测拿到）
  maskUrl?: string;
  /// 随机种子，默认 -1
  seed?: number;
  /// 覆盖 req_key（不传则用 env / 默认）
  reqKey?: string;
}

export interface OmniHumanJobResult {
  jobId: string;
  status: OmniHumanStatus;
  /// Provider 原始状态字符串（in_queue / generating / done / not_found / expired ...）
  rawProviderStatus: string;
  videoUrl?: string;
  errorMessage?: string;
  /// 完整 Provider 响应（仅 debug 用，不要直接展示给客户）
  rawProviderResponse?: unknown;
}

export function isOmniHumanConfigured(): boolean {
  return (
    !!process.env.VOLCENGINE_ACCESS_KEY_ID?.trim() &&
    !!process.env.VOLCENGINE_SECRET_ACCESS_KEY?.trim()
  );
}

function resolveReqKey(override?: string): string {
  return (
    override?.trim() ||
    process.env.VOLC_OMNIHUMAN_REQ_KEY?.trim() ||
    DEFAULT_REQ_KEY
  );
}

/* ------------------------------------------------------------------ */
/* 火山引擎 OpenAPI 签名 V4                                             */
/* ------------------------------------------------------------------ */

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/// 火山签名密钥派生：注意与 AWS 不同——kDate 直接用 SecretKey（不加 "AWS4" 前缀），
/// 末段固定字符串为 "request"（不是 "aws4_request"）。
function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "request");
}

interface VisualResponse {
  code?: number;
  message?: string;
  request_id?: string;
  status?: number;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * 对火山 Visual 服务发起一次签名后的 POST 请求。
 * Action 走 URL query，业务参数走 JSON body。
 */
async function visualRequest(
  action: string,
  body: Record<string, unknown>,
): Promise<VisualResponse> {
  const accessKeyId = process.env.VOLCENGINE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.VOLCENGINE_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "OmniHuman 需要火山引擎 AK/SK：请在 .env.local 配置 " +
        "VOLCENGINE_ACCESS_KEY_ID 与 VOLCENGINE_SECRET_ACCESS_KEY，" +
        "并确认该账号已开通「智能视觉服务」+ OmniHuman 权限。",
    );
  }

  const host = process.env.VOLC_VISUAL_HOST?.trim() || DEFAULT_HOST;
  const region = process.env.VOLC_VISUAL_REGION?.trim() || DEFAULT_REGION;
  const service = process.env.VOLC_VISUAL_SERVICE?.trim() || DEFAULT_SERVICE;
  const version = process.env.VOLC_VISUAL_VERSION?.trim() || DEFAULT_VERSION;

  const bodyStr = JSON.stringify(body);
  const payloadHash = sha256Hex(bodyStr);

  /// X-Date: ISO basic 格式 YYYYMMDD'T'HHMMSS'Z'（UTC，无分隔符、无毫秒）
  const xDate = new Date()
    .toISOString()
    .replace(/\.\d{3}/, "")
    .replace(/[-:]/g, "");
  const dateStamp = xDate.slice(0, 8);

  /// canonical query：按 key 字典序（Action < Version），值做 URL 编码
  const queryString = `Action=${encodeURIComponent(
    action,
  )}&Version=${encodeURIComponent(version)}`;

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${host}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${xDate}\n`;
  const signedHeaders = "content-type;host;x-content-sha256;x-date";

  const canonicalRequest = [
    "POST",
    "/",
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(
    secretAccessKey,
    dateStamp,
    region,
    service,
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}/?${queryString}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: host,
        "X-Date": xDate,
        "X-Content-Sha256": payloadHash,
        Authorization: authorization,
      },
      body: bodyStr,
    });
  } catch (err) {
    throw new Error(`OmniHuman(Visual) 网络请求失败：${(err as Error).message}`);
  }

  const raw = await res.text();
  let json: VisualResponse;
  try {
    json = JSON.parse(raw) as VisualResponse;
  } catch {
    throw new Error(
      `OmniHuman(Visual) 返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 300)}`,
    );
  }

  /// 火山 Visual：HTTP 非 2xx，或业务 code 非 10000 视为失败。
  if (!res.ok || (typeof json.code === "number" && json.code !== 10000)) {
    throw new Error(
      `OmniHuman(Visual) ${action} 失败：HTTP ${res.status} code=${
        json.code ?? "?"
      } message=${json.message ?? raw.slice(0, 300)}`,
    );
  }

  return json;
}

/* ------------------------------------------------------------------ */
/* OmniHuman 提交 / 轮询                                                */
/* ------------------------------------------------------------------ */

/**
 * 提交一个 OmniHuman 对口型生成任务，返回 task_id（jobId）。
 */
export async function submitOmniHumanJob(
  opts: OmniHumanSubmitOptions,
): Promise<{ jobId: string }> {
  if (!opts.imageUrl || !opts.audioUrl) {
    throw new Error("OmniHuman 提交需要 imageUrl 与 audioUrl（均为公网可达 URL）");
  }
  const body: Record<string, unknown> = {
    req_key: resolveReqKey(opts.reqKey),
    image_url: opts.imageUrl,
    audio_url: opts.audioUrl,
    seed: opts.seed ?? -1,
  };
  if (opts.prompt) body.prompt = opts.prompt;
  if (opts.maskUrl) body.mask_url = opts.maskUrl;

  const json = await visualRequest("CVSync2AsyncSubmitTask", body);
  const taskId =
    (json.data?.task_id as string | undefined) ??
    (json.data?.["task_id"] as string | undefined);
  if (!taskId) {
    throw new Error(
      `OmniHuman 提交未返回 task_id（数据形态变更？）：${JSON.stringify(
        json,
      ).slice(0, 300)}`,
    );
  }
  return { jobId: taskId };
}

/**
 * 查询 OmniHuman 任务状态；完成时带 videoUrl。
 */
export async function getOmniHumanStatus(
  jobId: string,
  reqKey?: string,
): Promise<OmniHumanJobResult> {
  const json = await visualRequest("CVSync2AsyncGetResult", {
    req_key: resolveReqKey(reqKey),
    task_id: jobId,
  });

  const data = json.data ?? {};
  const rawStatus = String(data.status ?? "");
  const videoUrl = extractVideoUrl(data);

  return {
    jobId,
    status: mapOmniHumanStatus(rawStatus, videoUrl),
    rawProviderStatus: rawStatus,
    videoUrl,
    errorMessage: isFailureStatus(rawStatus)
      ? (json.message as string | undefined) || `OmniHuman 任务失败（${rawStatus}）`
      : undefined,
    rawProviderResponse: json,
  };
}

/// video_url 通常直接在 data.video_url；个别返回会把结果塞在 resp_data（JSON 字符串）里。
function extractVideoUrl(data: Record<string, unknown>): string | undefined {
  const direct = data.video_url;
  if (typeof direct === "string" && direct) return direct;
  const respData = data.resp_data;
  if (typeof respData === "string" && respData) {
    try {
      const parsed = JSON.parse(respData) as { video_url?: string };
      if (parsed.video_url) return parsed.video_url;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function mapOmniHumanStatus(
  raw: string,
  videoUrl?: string,
): OmniHumanStatus {
  const normalized = raw.toLowerCase();
  if (["done", "success", "succeeded", "completed"].includes(normalized)) {
    /// 偶发：status=done 但 video_url 还没回填 → 视作仍在处理，让上层继续轮询。
    return videoUrl ? "completed" : "processing";
  }
  if (isFailureStatus(normalized)) return "failed";
  if (["in_queue", "pending", "queued", "waiting"].includes(normalized)) {
    return "pending";
  }
  /// generating / processing / 未知 → 仍在生成
  return "processing";
}

function isFailureStatus(raw: string): boolean {
  return ["not_found", "expired", "failed", "error", "cancelled", "canceled"].includes(
    raw.toLowerCase(),
  );
}

/// 仅供测试导入：纯函数版本
export const __test__ = {
  mapOmniHumanStatus,
  isFailureStatus,
  extractVideoUrl,
  deriveSigningKey,
  resolveReqKey,
};
