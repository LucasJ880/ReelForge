/**
 * Microsoft Edge TTS Provider（Free 通道语音合成）
 *
 * 完全免费，无需 API key
 * 支持多语言：中 / 英 / 日 / 韩 / 西 / 法 / 德 / 越 / 印尼
 *
 * Mock 模式（VIDEO_ENGINE_MOCK=true）：返回静音 mp3 占位，避免测试时打真实端口
 *
 * 注意：本文件只在服务端运行（msedge-tts 依赖 node `fs`/`stream`）。
 * 客户端需要音色列表请 import 自 `@/lib/voices`。
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { DEFAULT_VOICE_ID } from "@/lib/voices";

export { VOICE_CATALOG, DEFAULT_VOICE_ID, groupVoicesByLanguage } from "@/lib/voices";
export type { VoiceOption } from "@/lib/voices";

export interface TTSResult {
  audio: Buffer;
  mimeType: "audio/mpeg";
  durationEstimateMs: number;
}

function isMockMode(): boolean {
  return process.env.VIDEO_ENGINE_MOCK === "true";
}

function estimateDurationMs(text: string, voiceId: string): number {
  const isCJK = /^(zh|ja|ko)/.test(voiceId);
  if (isCJK) {
    const chars = text.replace(/\s+/g, "").length;
    return Math.round((chars / 3.5) * 1000);
  }
  const words = text.trim().split(/\s+/).length;
  return Math.round((words / 2.5) * 1000);
}

function buildSilentMp3(): Buffer {
  return Buffer.from(
    "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYxLjcuMTAwAAAAAAAAAAAAAAD/+5DEAAAKHKFgFHSAAOSaK0KPSAABjA4wSEAoIEBGIoKxhWN8gaMQYoLDAYKCw6KCx6KHhAICgwKOHg4OHhwKOHg4OCggEBQSFAwMDgoIBAIBAYDAYGBgUCgUEAQCgUCgUDAoFBIJDgYGBQUFAoJBIIBBYNCgYDAYGBAMBgMCgwGBQQFBIUBAYFBIIBAIDBYJCAQGAwKAQGAwKBQQCAYFAgEBgUCAQCAQGBQQCAwKBQQCAYFBAICAQGAwGBQQFBIIBAICAoEAQGBQKBQSCAgGBgIBAYFAgIBAICAQGAgMBAUCAgEBAIBAIBAoEAgEAgEAgEBAQEAgIBAQEAgEAgMCAQEAgEAgIBAIBAICAwIBAQCAwIBAQCAwKBQQCAYFBAUCAgKCAYFAgICAgEAgICAgICAQCAQEAgKBQQBAYFBAMCAYFBAQEAQCAQEAgICAgICAQCAgICAgICAgICAgICAgICAgIA==",
    "base64",
  );
}

export async function synthesizeSpeech(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID,
  rate: number = 0,
): Promise<TTSResult> {
  if (isMockMode()) {
    return {
      audio: buildSilentMp3(),
      mimeType: "audio/mpeg",
      durationEstimateMs: estimateDurationMs(text, voiceId),
    };
  }

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(text, { rate });
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    audioStream.on("data", (c: Buffer) => chunks.push(c));
    audioStream.on("close", resolve);
    audioStream.on("error", reject);
  });

  const audio = Buffer.concat(chunks);
  tts.close();

  return {
    audio,
    mimeType: "audio/mpeg",
    durationEstimateMs: estimateDurationMs(text, voiceId),
  };
}
