"use client";

import { useMemo } from "react";
import { VOICE_CATALOG, DEFAULT_VOICE_ID } from "@/lib/voices";

export interface FreeChannelOptionsValue {
  voiceId: string;
  rate: number;
}

export const DEFAULT_FREE_OPTIONS: FreeChannelOptionsValue = {
  voiceId: DEFAULT_VOICE_ID,
  rate: 0,
};

export function FreeChannelOptions({
  value,
  onChange,
  disabled,
}: {
  value: FreeChannelOptionsValue;
  onChange: (v: FreeChannelOptionsValue) => void;
  disabled?: boolean;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, typeof VOICE_CATALOG> = {};
    for (const v of VOICE_CATALOG) {
      if (!g[v.language]) g[v.language] = [];
      g[v.language].push(v);
    }
    return g;
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
          Free 通道选项
        </span>
        <span className="text-[11px] text-muted-foreground">
          免费浏览器合成 · Edge TTS + Pexels
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">配音音色</span>
          <select
            disabled={disabled}
            value={value.voiceId}
            onChange={(e) => onChange({ ...value, voiceId: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {Object.entries(grouped).map(([language, voices]) => (
              <optgroup key={language} label={language}>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} {v.gender === "Female" ? "♀" : "♂"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">
            语速调整 <span className="text-foreground">{value.rate >= 0 ? `+${value.rate}` : value.rate}%</span>
          </span>
          <input
            disabled={disabled}
            type="range"
            min={-30}
            max={30}
            step={5}
            value={value.rate}
            onChange={(e) => onChange({ ...value, rate: Number(e.target.value) })}
            className="w-full accent-[oklch(var(--primary))]"
          />
        </label>
      </div>
    </div>
  );
}
