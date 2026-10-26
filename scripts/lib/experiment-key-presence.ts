/**
 * 本轮实验采购的 key 是否已配置（X-SCAF-4；命名见路线图 D-8）。
 *
 * 只回答「配没配」，**输出里绝不出现 key 的值**（连前后几位都不带）；也不触网——
 * 这些都是付费供应商，免费的账户探测各家形态不一，真机验证留给各自实验第一步。
 * `TTS_PROVIDER` 不是凭据，可以回显。
 *
 * 纯函数：env 由调用方传入，便于单测。
 */

export type KeyPresenceVerdict = "已配置" | "未配置" | "配置有误";

export interface KeyPresenceRow {
  line: string;
  verdict: KeyPresenceVerdict;
  detail: string;
}

type EnvLike = Record<string, string | undefined>;

function has(env: EnvLike, name: string): boolean {
  return Boolean(env[name]?.trim());
}

/** D-8：TTS_PROVIDER → 对应 key 名。 */
export const TTS_PROVIDER_KEYS = {
  elevenlabs: "ELEVENLABS_API_KEY",
  minimax: "MINIMAX_API_KEY",
} as const;

export function ttsKeyPresence(env: EnvLike): KeyPresenceRow {
  const line = "TTS 试用（逐词时间戳，E3b/E16/D-13）";
  const present = Object.values(TTS_PROVIDER_KEYS).filter((name) => has(env, name));
  const provider = env.TTS_PROVIDER?.trim().toLowerCase();
  if (!provider) {
    return {
      line,
      verdict: "未配置",
      detail: present.length
        ? `缺 TTS_PROVIDER（已有 ${present.join(" / ")}）`
        : `缺 TTS_PROVIDER 与 ${Object.values(TTS_PROVIDER_KEYS).join(" / ")}`,
    };
  }
  if (!(provider in TTS_PROVIDER_KEYS)) {
    return {
      line,
      verdict: "配置有误",
      detail: `TTS_PROVIDER=${provider.slice(0, 32)} 不在 ${Object.keys(TTS_PROVIDER_KEYS).join(" / ")} 内`,
    };
  }
  const keyName = TTS_PROVIDER_KEYS[provider as keyof typeof TTS_PROVIDER_KEYS];
  return has(env, keyName)
    ? { line, verdict: "已配置", detail: `TTS_PROVIDER=${provider} · ${keyName} 已配置（未触网验证）` }
    : { line, verdict: "未配置", detail: `TTS_PROVIDER=${provider} 但缺 ${keyName}` };
}

export function experimentKeyPresence(env: EnvLike): KeyPresenceRow[] {
  const cutout = ["REMOVE_BG_API_KEY", "CLIPDROP_API_KEY"].filter((name) => has(env, name));
  return [
    has(env, "SYNC_API_KEY")
      ? { line: "Sync Labs 口型（D-13）", verdict: "已配置", detail: "SYNC_API_KEY 已配置（未触网验证）" }
      : { line: "Sync Labs 口型（D-13）", verdict: "未配置", detail: "缺 SYNC_API_KEY" },
    ttsKeyPresence(env),
    cutout.length
      ? { line: "抠图 key（E14 / P02-E）", verdict: "已配置", detail: `${cutout.join(" + ")} 已配置（未触网验证）` }
      : { line: "抠图 key（E14 / P02-E）", verdict: "未配置", detail: "缺 REMOVE_BG_API_KEY / CLIPDROP_API_KEY" },
  ];
}
