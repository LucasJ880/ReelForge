/**
 * 数字人探店广告 · 预置中文音色目录
 * ==================================================================
 *
 * MVP 只用火山「大模型语音合成」（豆包语音）的 **2.0 预置音色**（*_uranus_bigtts），
 * 情感最足、最像真人，走 V3 流式接口（resourceId=seed-tts-2.0）。
 *
 * 这些 voiceType 直接传给 `synthesizeSpeech({ voiceType })`（见 providers/volc-tts.ts）。
 *
 * 注意：使用前需在火山控制台对该音色完成 0 元下单授权，否则合成会报权限错误。
 * 自有声音复刻（seed-icl-2.0 + Speaker ID）是 phase 2，不在此目录。
 */

export interface DigitalHumanVoice {
  /// 稳定 id（前端选择 / DB 存储用）
  id: string;
  /// 展示名
  name: string;
  /// 火山音色 ID（speaker），传给 synthesizeSpeech
  voiceType: string;
  /// 资源版本（2.0 → seed-tts-2.0，走 V3）
  resourceId: string;
  gender: "female" | "male";
  /// 一句话风格描述
  description: string;
  /// 试听样例公网 URL（可选；留空则前端不显示试听）
  sampleUrl?: string | null;
}

/**
 * MVP 预置音色（2.0，最像真人）。
 * 默认与 providers/volc-tts.ts 的 DEFAULT_VOICE（邻家女孩）保持一致。
 */
export const VOICES: DigitalHumanVoice[] = [
  {
    id: "voice-linjia",
    name: "邻家女孩",
    voiceType: "zh_female_linjianvhai_uranus_bigtts",
    resourceId: "seed-tts-2.0",
    gender: "female",
    description: "自然亲切、像在和朋友分享，探店口播首选。",
    sampleUrl: null,
  },
  {
    id: "voice-sisi",
    name: "爽快思思",
    voiceType: "zh_female_shuangkuaisisi_uranus_bigtts",
    resourceId: "seed-tts-2.0",
    gender: "female",
    description: "干脆利落、节奏明快，种草 / 卖点讲解有活力。",
    sampleUrl: null,
  },
  {
    id: "voice-vivi",
    name: "Vivi",
    voiceType: "zh_female_vv_uranus_bigtts",
    resourceId: "seed-tts-2.0",
    gender: "female",
    description: "温柔甜美、亲和力强，适合治愈系 / 生活方式门店。",
    sampleUrl: null,
  },
];

export const DEFAULT_VOICE_ID = "voice-linjia";

export function getVoiceById(id: string): DigitalHumanVoice | undefined {
  return VOICES.find((v) => v.id === id);
}

export function listVoices(): DigitalHumanVoice[] {
  return VOICES;
}
