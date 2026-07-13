/**
 * 火山引擎「大模型语音合成」（豆包语音）Provider —— 中文口播旁白合成。
 *
 * 用途：数字人探店广告等成片的中文配音，追求「真人探店感」，避免僵硬 AI 腔。
 *
 * 同时支持两代音色 / 两套接口，按 VOLC_TTS_RESOURCE_ID 自动选择：
 *
 *   ┌── 2.0 音色（*_uranus_bigtts，情感最足、最像真人）──────────────────┐
 *   │ V3 单向流式 chunked： POST .../api/v3/tts/unidirectional             │
 *   │ Header: X-Api-App-Id + X-Api-Access-Key + X-Api-Resource-Id          │
 *   │         （或新版控制台单用 X-Api-Key）                                │
 *   │ Body:  { user, req_params:{ text, speaker, audio_params, additions }}│
 *   │ 返回:  chunked，多条 JSON，音频块 {code:0,data:<base64>}，           │
 *   │        结束块 {code:20000000}                                        │
 *   └─────────────────────────────────────────────────────────────────────┘
 *   ┌── 1.0 音色（*_mars_bigtts / *_moon_bigtts）──────────────────────────┐
 *   │ V1 非流式：POST .../api/v1/tts                                       │
 *   │ Header: Authorization: "Bearer;{access_token}"                       │
 *   │ Body:  { app, user, audio, request }，operation=query                │
 *   │ 返回:  JSON，code=3000 成功，data 为整段 base64 音频                  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * 这是独立于 Ark（大模型推理）的服务，鉴权用「语音合成大模型」控制台的
 * appid + access_token（或新版 API Key），不是 ARK_API_KEY。环境变量：
 *   VOLC_TTS_APPID         应用 appid（X-Api-App-Id）
 *   VOLC_TTS_ACCESS_TOKEN  访问令牌（X-Api-Access-Key / V1 Bearer token）
 *   VOLC_TTS_API_KEY       新版控制台 API Key（可替代上面两个，仅 V3）
 *   VOLC_TTS_RESOURCE_ID   计费/版本资源 ID，默认 seed-tts-2.0（→ 走 V3）
 *                          设为空 / volcano_tts 系则走 V1（1.0 音色）
 *   VOLC_TTS_CLUSTER       V1 集群，默认 volcano_tts
 *   VOLC_TTS_VOICE_TYPE    默认音色 ID（speaker）
 *   VOLC_TTS_ENDPOINT_V3 / VOLC_TTS_ENDPOINT_V1  可选，覆盖接口地址
 *
 * 文档：V1 https://www.volcengine.com/docs/6561/79820
 *       V3 https://docs.volcengine.com/docs/6561/1598757
 */
import { randomUUID } from "node:crypto";
import { dryRunRefusalError, isDryRun } from "@/lib/config/dry-run";

const DEFAULT_ENDPOINT_V1 = "https://openspeech.bytedance.com/api/v1/tts";
const DEFAULT_ENDPOINT_V3 =
  "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEFAULT_CLUSTER = "volcano_tts";
const DEFAULT_RESOURCE_ID = "seed-tts-2.0";
/// 自然、亲切的「邻家女孩 2.0」女声（大模型 2.0 音色），最像真人、适合探店口播；
/// 用户可在控制台试听后用 VOLC_TTS_VOICE_TYPE 覆盖（需对该音色完成 0 元下单授权）。
const DEFAULT_VOICE = "zh_female_linjianvhai_uranus_bigtts";

export interface VolcTtsOptions {
  /// 要合成的中文文本（UTF-8 ≤ 1024 字节/次）
  text: string;
  /// 音色 ID（speaker）；不传则用 VOLC_TTS_VOICE_TYPE / 内置默认
  voiceType?: string;
  /// 输出编码，默认 mp3
  encoding?: "mp3" | "wav" | "pcm" | "ogg_opus";
  /// V1 语速 0.2~3.0（默认 1.0）
  speedRatio?: number;
  /// V1 音量 0.1~3.0（默认 1.0）
  volumeRatio?: number;
  /// V1 音高 0.1~3.0（默认 1.0）
  pitchRatio?: number;
  /// V3 语速 [-50,100]（0=正常，正值更快）
  speechRate?: number;
  /// V3 音量 [-50,100]
  loudnessRate?: number;
  /// 情绪（部分音色支持，如 happy）
  emotion?: string;
  /// V3 情绪强度 1~5（默认 4）
  emotionScale?: number;
  /// V3 2.0 表现力提示（自然语言指令，如「用轻松愉快的探店语气说」）
  contextTexts?: string[];
  /// 业务侧唯一用户标识
  uid?: string;
}

function resolveResourceId(): string {
  const v = process.env.VOLC_TTS_RESOURCE_ID?.trim();
  return v === undefined || v === "" ? DEFAULT_RESOURCE_ID : v;
}

/// resource id 以 seed- 开头 → 走 V3（大模型 2.0 / 1.0 字符版）；否则走 V1。
function shouldUseV3(): boolean {
  return resolveResourceId().startsWith("seed-");
}

export function isVolcTtsConfigured(): boolean {
  if (isDryRun()) return false;
  const hasApiKey = !!process.env.VOLC_TTS_API_KEY?.trim();
  const hasAppPair =
    !!process.env.VOLC_TTS_APPID?.trim() &&
    !!process.env.VOLC_TTS_ACCESS_TOKEN?.trim();
  return hasApiKey || hasAppPair;
}

/**
 * 合成一段中文语音，返回音频 Buffer（默认 mp3）。
 */
export async function synthesizeSpeech(opts: VolcTtsOptions): Promise<Buffer> {
  if (isDryRun()) throw dryRunRefusalError("volc-tts");
  if (!isVolcTtsConfigured()) {
    throw new Error(
      "缺少火山语音合成凭证：请在 .env.local 配置 VOLC_TTS_API_KEY，或 VOLC_TTS_APPID + VOLC_TTS_ACCESS_TOKEN。",
    );
  }
  return shouldUseV3() ? synthesizeV3(opts) : synthesizeV1(opts);
}

/* ----------------------------- V3（2.0 音色） ----------------------------- */

async function synthesizeV3(opts: VolcTtsOptions): Promise<Buffer> {
  const endpoint = process.env.VOLC_TTS_ENDPOINT_V3?.trim() || DEFAULT_ENDPOINT_V3;
  const resourceId = resolveResourceId();
  const speaker =
    opts.voiceType || process.env.VOLC_TTS_VOICE_TYPE?.trim() || DEFAULT_VOICE;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": randomUUID(),
  };
  const apiKey = process.env.VOLC_TTS_API_KEY?.trim();
  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
    /// 新版控制台仍可附带 App-Id；旧版必须用 App-Id + Access-Key。
    if (process.env.VOLC_TTS_APPID?.trim()) {
      headers["X-Api-App-Id"] = process.env.VOLC_TTS_APPID.trim();
    }
  } else {
    headers["X-Api-App-Id"] = process.env.VOLC_TTS_APPID!.trim();
    headers["X-Api-Access-Key"] = process.env.VOLC_TTS_ACCESS_TOKEN!.trim();
  }

  const audioParams: Record<string, unknown> = {
    format: opts.encoding || "mp3",
    sample_rate: 24000,
  };
  if (opts.speechRate !== undefined) audioParams.speech_rate = opts.speechRate;
  if (opts.loudnessRate !== undefined) audioParams.loudness_rate = opts.loudnessRate;
  if (opts.emotion) {
    audioParams.emotion = opts.emotion;
    audioParams.emotion_scale = opts.emotionScale ?? 4;
  }

  const reqParams: Record<string, unknown> = {
    text: opts.text,
    speaker,
    audio_params: audioParams,
  };

  /// additions 必须是 JSON 字符串（不是对象）。承载 context_texts（表现力提示）
  /// 与 model_type（声音复刻 2.0 必须为 4）。
  const additions: Record<string, unknown> = {};
  if (opts.contextTexts && opts.contextTexts.length > 0) {
    additions.context_texts = opts.contextTexts;
  }
  if (resourceId.startsWith("seed-icl")) {
    /// 声音复刻（克隆音色 S_xxx）走 seed-icl-2.0，model_type 必须加 4。
    additions.model_type = 4;
  }
  if (Object.keys(additions).length > 0) {
    reqParams.additions = JSON.stringify(additions);
  }

  const body = {
    user: { uid: opts.uid || "aivora-store-ad" },
    req_params: reqParams,
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`火山 TTS(V3) 网络请求失败：${(err as Error).message}`);
  }

  const raw = await res.text();
  const objects = extractJsonObjects(raw);
  if (objects.length === 0) {
    throw new Error(
      `火山 TTS(V3) 返回无法解析（HTTP ${res.status}）：${raw.slice(0, 300)}`,
    );
  }

  const chunks: Buffer[] = [];
  for (const obj of objects) {
    const code = obj.code as number | undefined;
    /// 0=音频/文本块；20000000=合成结束；其余视为错误。
    if (code !== undefined && code !== 0 && code !== 20000000) {
      throw new Error(
        `火山 TTS(V3) 失败：code=${code} message=${
          obj.message ?? ""
        }（speaker=${speaker} resource=${resourceId}）`,
      );
    }
    if (typeof obj.data === "string" && obj.data.length > 0) {
      chunks.push(Buffer.from(obj.data, "base64"));
    }
  }

  if (chunks.length === 0) {
    throw new Error(
      `火山 TTS(V3) 未返回音频数据（speaker=${speaker} resource=${resourceId}）：${raw.slice(
        0,
        300,
      )}`,
    );
  }
  return Buffer.concat(chunks);
}

/* ----------------------------- V1（1.0 音色） ----------------------------- */

async function synthesizeV1(opts: VolcTtsOptions): Promise<Buffer> {
  const appid = process.env.VOLC_TTS_APPID?.trim();
  const token = process.env.VOLC_TTS_ACCESS_TOKEN?.trim();
  if (!appid || !token) {
    throw new Error(
      "V1（1.0 音色）需要 VOLC_TTS_APPID + VOLC_TTS_ACCESS_TOKEN。",
    );
  }
  const endpoint = process.env.VOLC_TTS_ENDPOINT_V1?.trim() || DEFAULT_ENDPOINT_V1;
  const cluster = process.env.VOLC_TTS_CLUSTER?.trim() || DEFAULT_CLUSTER;
  const voiceType =
    opts.voiceType || process.env.VOLC_TTS_VOICE_TYPE?.trim() || DEFAULT_VOICE;

  const body = {
    app: { appid, token, cluster },
    user: { uid: opts.uid || "aivora-store-ad" },
    audio: {
      voice_type: voiceType,
      encoding: opts.encoding || "mp3",
      speed_ratio: opts.speedRatio ?? 1.0,
      volume_ratio: opts.volumeRatio ?? 1.0,
      pitch_ratio: opts.pitchRatio ?? 1.0,
      ...(opts.emotion ? { emotion: opts.emotion } : {}),
    },
    request: {
      reqid: randomUUID(),
      text: opts.text,
      text_type: "plain",
      operation: "query",
      with_frontend: 1,
    },
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        /// 火山 V1 要求 "Bearer;{token}"（分号分隔），不是常规空格。
        Authorization: `Bearer;${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`火山 TTS(V1) 网络请求失败：${(err as Error).message}`);
  }

  const raw = await res.text();
  let json: { code?: number; message?: string; data?: string };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      `火山 TTS(V1) 返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 300)}`,
    );
  }
  if (json.code !== 3000 || !json.data) {
    throw new Error(
      `火山 TTS(V1) 失败：code=${json.code ?? "?"} message=${
        json.message ?? raw.slice(0, 300)
      }（voice_type=${voiceType} cluster=${cluster}）`,
    );
  }
  return Buffer.from(json.data, "base64");
}

/* ------------------------------- 工具函数 -------------------------------- */

/**
 * 从 chunked/拼接的响应文本里提取所有顶层 JSON 对象（兼容 NDJSON 与无分隔拼接）。
 * 用括号配平扫描，忽略字符串内部的花括号。
 */
function extractJsonObjects(text: string): Array<Record<string, unknown>> {
  const objs: Array<Record<string, unknown>> = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          objs.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* 跳过不完整片段 */
        }
        start = -1;
      }
    }
  }
  return objs;
}
