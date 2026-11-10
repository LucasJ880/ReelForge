"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BGM_CATALOG, type BgmTrackId } from "@/lib/video-generation/bgm-catalog";

/**
 * 选配乐（2026-11-10）：创作页「更多设置」与成片详情「换字幕 / BGM / 落款」共用。
 * 曲目从目录（bgm-catalog）列出来，不再手写两个 option；选中的那首写一句气质说明，能试听的给一个试听钮。
 * 试听只在浏览器里放 public 下的同一个文件——听到的就是会混进成片的那一首（成片里音量更小、口播时会让开）。
 */
export function BgmPicker({
  value,
  onChange,
  disabled = false,
  english,
  selectClassName,
  id,
}: {
  value: BgmTrackId;
  onChange: (next: BgmTrackId) => void;
  disabled?: boolean;
  english: boolean;
  selectClassName: string;
  id?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const selected = BGM_CATALOG.find((track) => track.id === value) ?? BGM_CATALOG[0];
  const mood = selected.mood[english ? "en" : "zh"];

  /// 换了曲目或组件卸载：正在放的那首停掉
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      setPlaying(false);
    };
  }, [value]);

  function togglePreview() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      return;
    }
    /// 播放被浏览器拦下（没有用户手势等）就当没点，不报错
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <div className="space-y-2" data-testid="bgm-picker">
      <select
        id={id}
        value={value}
        disabled={disabled}
        className={selectClassName}
        onChange={(event) => onChange(event.target.value as BgmTrackId)}
      >
        {BGM_CATALOG.map((track) => (
          <option key={track.id} value={track.id}>
            {english ? track.en : track.zh}
          </option>
        ))}
      </select>
      {mood || selected.previewUrl ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {mood ? <p className="min-w-0 flex-1 text-pretty text-meta font-normal text-tertiary">{mood}</p> : null}
          {selected.previewUrl ? (
            <>
              <Button type="button" variant="outline" size="xs" disabled={disabled} aria-pressed={playing} onClick={togglePreview} data-testid="bgm-preview">
                {playing ? <Square aria-hidden /> : <Play aria-hidden />}
                {playing ? (english ? "Stop" : "停止") : english ? "Preview" : "试听"}
              </Button>
              {/* key 跟着曲目换：换曲后是一个新的 audio，不会接着放上一首 */}
              <audio key={selected.id} ref={audioRef} src={selected.previewUrl} preload="none" onEnded={() => setPlaying(false)} />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
