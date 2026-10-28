/**
 * 口播稿撰写（2026-10-28 闭环轮 E2E 发现：「生成口播稿」是纯本地模板——固定开场「先看它如何改变日常体验」+
 * 截取描述前几个分句 + 固定结尾，成片会原样念出来）。改成 LLM 按商家原话写一段一人口播，
 * 字数按时长封顶（中文约 4 字 / 秒，英文约 2.2 词 / 秒，与模板同一把尺）；任何失败都退回模板，界面不卡住。
 */
import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";

export interface VoiceoverDraftInput {
  prompt: string;
  durationSec: number;
  language: string;
  cta?: string | null;
}

export interface VoiceoverDraftDeps {
  llmAvailable?: () => boolean;
  chat?: typeof chatJsonByTier;
  timeoutMs?: number;
}

const DRAFT_TIMEOUT_MS = 20_000;

export function voiceoverBudget(durationSec: number, english: boolean): number {
  return english ? Math.max(12, Math.floor(durationSec * 2.2)) : durationSec * 4;
}

function measure(text: string, english: boolean): number {
  return english ? text.split(/\s+/u).filter(Boolean).length : Array.from(text.replace(/\s+/gu, "")).length;
}

export const VOICEOVER_WRITER_SYSTEM_PROMPT = `You write the spoken voice-over for a short vertical ad made by a small local business.
Rules:
- One narrator speaking naturally to a customer, in the requested language. Plain spoken words only.
- Use the merchant's own facts: what the product is, the moment it helps, the one benefit to remember. Never invent prices, discounts, awards, guarantees or statistics.
- No stage directions, no camera or format words (seconds, 9:16, close-up, UGC, captions, music), no hashtags, no emoji.
- Fit the length budget exactly or under it. End with a short, friendly call to action (use the provided one if given).
Return JSON only: {"script":"..."}`;

export async function writeVoiceoverScript(
  input: VoiceoverDraftInput,
  deps: VoiceoverDraftDeps = {},
): Promise<string | null> {
  const prompt = input.prompt.replace(/\s+/gu, " ").trim();
  if (!prompt) return null;
  const english = input.language.toLowerCase().startsWith("en");
  const available = deps.llmAvailable ?? (() => isLLMAvailable() && !isLLMForcedMock());
  if (!available()) return null;
  const budget = voiceoverBudget(input.durationSec, english);
  const chat = deps.chat ?? chatJsonByTier;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      chat<unknown>({
        tier: "fast",
        stage: "voiceover_draft",
        system: VOICEOVER_WRITER_SYSTEM_PROMPT,
        user: [
          `Language: ${english ? "English" : "Simplified Chinese (spoken Mandarin)"}`,
          `Video length: ${input.durationSec} seconds. Length budget: at most ${budget} ${english ? "words" : "Chinese characters (punctuation not counted)"}.`,
          input.cta?.trim() ? `Call to action to end with: ${input.cta.trim()}` : "Call to action: a short friendly invitation to get in touch or try it.",
          `Merchant's description: ${prompt.slice(0, 1800)}`,
        ].join("\n"),
        temperature: 0.6,
        maxTokens: 800,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deps.timeoutMs ?? DRAFT_TIMEOUT_MS);
      }),
    ]);
    if (!result) return null;
    const raw = result.data && typeof result.data === "object" ? (result.data as { script?: unknown }).script : null;
    const script = typeof raw === "string" ? raw.replace(/\s+/gu, english ? " " : "").trim() : "";
    if (!script || measure(script, english) > Math.ceil(budget * 1.15)) return null;
    return script;
  } catch (error) {
    console.warn("[voiceover-writer] draft failed; keeping template:", (error as Error).message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
