/**
 * Sealed compatibility stub. The former Volcengine implementation is archived
 * at deploy/china-future/code/volc-tts.ts and is not part of the active runtime.
 */
import { dryRunRefusalError, isDryRun } from "@/lib/config/dry-run";
import { assertDigitalHumanFeatureEnabled } from "@/lib/features/digital-human";

export interface VolcTtsOptions {
  text: string;
  voiceType?: string;
  encoding?: "mp3" | "wav" | "pcm" | "ogg_opus";
  speedRatio?: number;
  volumeRatio?: number;
  pitchRatio?: number;
  speechRate?: number;
  loudnessRate?: number;
  emotion?: string;
  emotionScale?: number;
  contextTexts?: string[];
  uid?: string;
}

export function isVolcTtsConfigured(): false {
  return false;
}

export async function synthesizeSpeech(_opts: VolcTtsOptions): Promise<Buffer> {
  void _opts;
  if (isDryRun()) throw dryRunRefusalError("volc-tts");
  assertDigitalHumanFeatureEnabled();
  throw new Error("DIGITAL_HUMAN_SEALED");
}
