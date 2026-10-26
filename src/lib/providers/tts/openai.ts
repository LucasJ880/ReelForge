/**
 * OpenAI TTS 实现（b-roll 线路的外挂配音）。
 *
 * 为什么是 OpenAI 而不是 edge-tts（MoneyPrinterTurbo 的默认）：
 * edge-tts 逆向微软消费端接口、无 SLA，放进商用管线等于自造下一个 Shuyu。
 * 决策与备选（Azure Speech）见 docs/roadmap/2026-08-01-required-api-keys.md。
 *
 * 复用 `OPENAI_API_KEY`（0802 起项目已开通 tts-1 权限）。
 * 无 key 时诚实不可用，与 stock-footage / remove-bg 同一模式，不 mock。
 * tts-1 不给时长与逐词时间戳：durationMs / words 留空，调用方 ffprobe 实测。
 *
 * ⚠️ 只做 b-roll 的外挂配音。主线 Seedance 原生口播由生成视频直接说出，
 * 绝不在主线成片上二次覆盖 TTS（stitch-service 的既有纪律）。
 */

import { markCapability } from "@/lib/services/capability-status-service";
import { isTtsProviderConfigured } from "@/lib/providers/tts/config";
import { TtsError, type TtsProvider, type TtsSynthesizeInput, type TtsSynthesizeResult } from "@/lib/providers/tts/types";
import { resolveTtsVoice } from "@/lib/providers/tts/voices";

/** 导出给能力探测（C4）：探测与生产合成必须打同一个端点、同一个模型。 */
export const OPENAI_TTS_ENDPOINT = "https://api.openai.com/v1/audio/speech";
export const OPENAI_TTS_MODEL = "tts-1";

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function createOpenAiTtsProvider(
  options: { fetchImpl?: typeof fetch; env?: EnvLike } = {},
): TtsProvider {
  const env = options.env ?? process.env;
  return {
    id: "openai",
    model: OPENAI_TTS_MODEL,
    supportsWordTimestamps: false,
    synthesize: (input) => synthesizeWithOpenAi(input, options.fetchImpl ?? fetch, env),
  };
}

async function synthesizeWithOpenAi(
  input: TtsSynthesizeInput,
  fetchImpl: typeof fetch,
  env: EnvLike,
): Promise<TtsSynthesizeResult> {
  if (!isTtsProviderConfigured("openai", env)) {
    throw new TtsError("OPENAI_API_KEY 未配置，TTS 不可用", null, false, "openai");
  }
  const key = env.OPENAI_API_KEY!.trim();
  const text = input.text.trim();
  if (!text) {
    throw new TtsError("口播文本为空", null, false, "openai");
  }

  const response = await fetchImpl(OPENAI_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: resolveTtsVoice("openai", input.voiceId),
      input: text,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    /// 日志脱敏：只留状态码与截断的错误体，不落 key、不落完整口播稿。
    const body = (await response.text().catch(() => "")).slice(0, 200);
    const retryable = response.status === 429 || response.status >= 500;
    const error = new TtsError(`TTS 合成失败：HTTP ${response.status} ${body}`, response.status, retryable, "openai");
    /// C4 · 「AI 配音」实时回写：403 没有模型权限 / 429 额度用完 → 暂停；5xx 与普通限流不改状态。
    await markCapability("voice", { error }, { detail: { provider: "openai", model: OPENAI_TTS_MODEL } });
    throw error;
  }
  await markCapability("voice", "success", { detail: { provider: "openai", model: OPENAI_TTS_MODEL } });

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength < 1024) {
    throw new TtsError("TTS 返回的音频异常（不足 1KB）", null, true, "openai");
  }
  return { audio, mime: "audio/mpeg" };
}
