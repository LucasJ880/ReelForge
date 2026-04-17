/**
 * Free Channel Service
 *
 * 参考 MoneyPrinterTurbo pipeline：
 *   1. contentPlan.script -> 按句切分
 *   2. 每句 -> Edge TTS（mp3 上传到 Blob）
 *   3. 每句 -> Pexels 搜竖屏素材
 *   4. 生成 SRT
 *   5. 产出一份 manifest，浏览器端用 ffmpeg.wasm 拼接输出 mp4
 *
 * 注意：该服务只生成"素材清单"，真正的视频合成发生在客户端（ffmpeg.wasm）。
 * 这么做是因为：
 *   - Vercel Serverless 函数有内存/时长限制，跑不动 ffmpeg
 *   - 合成成本（CPU）转嫁给用户，走免费通道更划算
 */

import { put } from "@vercel/blob";
import {
  searchPexelsVideos,
  type PexelsVideo,
} from "@/lib/providers/pexels";
import {
  synthesizeSpeech,
  DEFAULT_VOICE_ID,
} from "@/lib/providers/edge-tts";
import { splitIntoSentences, buildSrt, type SrtSegment } from "@/lib/utils/srt";

export interface FreeChannelClip {
  sentence: string;
  durationMs: number;
  audioUrl: string; // mp3 公共 URL（Blob）
  videoUrl: string; // Pexels mp4 直链（浏览器 ffmpeg 会再 fetch）
  videoThumb: string;
}

export interface FreeChannelManifest {
  channel: "free";
  voiceId: string;
  totalDurationMs: number;
  resolution: { width: number; height: number };
  clips: FreeChannelClip[];
  segments: SrtSegment[];
  srt: string;
  createdAt: string;
}

/**
 * 从脚本提取关键词：简化策略，取每句前 8 字作为搜索 query
 */
function extractQuery(sentence: string, keyword: string): string {
  const trimmed = sentence.replace(/[^\w\u4e00-\u9fa5\s]/g, " ").trim();
  if (trimmed.length === 0) return keyword;
  // 中文：取前 8 字；英文：取前 3 词
  if (/[\u4e00-\u9fa5]/.test(trimmed)) {
    return trimmed.slice(0, 8);
  }
  return trimmed.split(/\s+/).slice(0, 3).join(" ");
}

async function uploadAudio(buf: Buffer, keyPrefix: string): Promise<string> {
  const filename = `${keyPrefix}-${Date.now()}.mp3`;
  const blob = await put(filename, new Blob([buf as BlobPart], { type: "audio/mpeg" }), {
    access: "public",
    addRandomSuffix: true,
    contentType: "audio/mpeg",
  });
  return blob.url;
}

export interface BuildFreeManifestInput {
  projectId: string;
  script: string;
  keyword: string;
  voiceId?: string;
  rate?: number;
  resolution?: { width: number; height: number };
}

/**
 * 构建 Free 通道 manifest
 */
export async function buildFreeChannelManifest(
  input: BuildFreeManifestInput,
): Promise<FreeChannelManifest> {
  const {
    projectId,
    script,
    keyword,
    voiceId = DEFAULT_VOICE_ID,
    rate = 0,
    resolution = { width: 1080, height: 1920 },
  } = input;

  const sentences = splitIntoSentences(script);
  if (sentences.length === 0) {
    throw new Error("脚本内容为空或无法切分");
  }

  // 为每句并行：TTS + Pexels 搜素材
  const perSentence = await Promise.all(
    sentences.map(async (sentence, i) => {
      const query = extractQuery(sentence, keyword);

      const [ttsRes, pexelsVideos] = await Promise.all([
        synthesizeSpeech(sentence, voiceId, rate),
        searchPexelsVideos(query, 3).catch(() => [] as PexelsVideo[]),
      ]);

      const audioUrl = await uploadAudio(
        ttsRes.audio,
        `free/${projectId}/audio-${i}`,
      );

      // 找不到对应 Pexels 素材时降级到 mock 列表
      const video =
        pexelsVideos[0] ?? (await searchPexelsVideos("abstract", 1))[0];
      if (!video) {
        throw new Error(`无法为第 ${i + 1} 句获取素材（keyword=${query}）`);
      }

      return {
        sentence,
        durationMs: ttsRes.durationEstimateMs,
        audioUrl,
        videoUrl: video.url,
        videoThumb: video.thumbnail,
      } satisfies FreeChannelClip;
    }),
  );

  const durations = perSentence.map((c) => c.durationMs);
  const { srt, segments } = buildSrt(sentences, durations);
  const totalDurationMs = durations.reduce((a, b) => a + b, 0);

  return {
    channel: "free",
    voiceId,
    totalDurationMs,
    resolution,
    clips: perSentence,
    segments,
    srt,
    createdAt: new Date().toISOString(),
  };
}
