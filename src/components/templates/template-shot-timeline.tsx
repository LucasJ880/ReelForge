import { MonoTag } from "@/components/exchange/mono-tag";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { TEMPLATE_LIBRARY_COPY, fillCount } from "@/components/templates/template-library-copy";

/** 配方里冻结的一个镜头节拍：起止秒 + 节拍名（HOOK / PROOF / CTA HOLD …）。 */
export type TemplateShot = {
  start: number;
  end: number;
  beat: string;
};

const STORYBOARD_MARKER = "TIMED STORYBOARD:";
/// 「- 0-3s HOOK: …」「- 3-10s SOLUTION PROOF: …」
const BEAT_LINE = /^-\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s\s+([A-Z][A-Z /&+-]*?)\s*:/;

/**
 * 从模板这一版的 promptSkeleton 读出分镜：批量生成真正用的就是这段 TIMED STORYBOARD，
 * 所以时间线与出片一致。读不出或时间不连贯就返回空 —— 宁可不画，也不画一条错的时间线。
 */
export function parseTemplateShots(promptSkeleton: string): TemplateShot[] {
  const markerAt = promptSkeleton.indexOf(STORYBOARD_MARKER);
  if (markerAt < 0) return [];
  const shots: TemplateShot[] = [];
  for (const raw of promptSkeleton.slice(markerAt + STORYBOARD_MARKER.length).split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (shots.length > 0) break;
      continue;
    }
    const match = BEAT_LINE.exec(line);
    if (!match) break;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const previousEnd = shots.at(-1)?.end ?? 0;
    if (!(end > start) || start < previousEnd) return [];
    shots.push({ start, end, beat: match[3].trim() });
  }
  return shots;
}

/**
 * 没有验收样片的模板：媒体位不留白也不编图，下沉井里画这份配方真实的分镜时间线，
 * 每格宽度按秒数等比，顶部一枚「样片待补」状态。
 */
export function TemplateShotTimeline({
  shots,
  duration,
  aspectRatio,
  locale,
}: {
  shots: TemplateShot[];
  duration: number | undefined;
  aspectRatio: string | undefined;
  locale: Locale;
}) {
  const copy = TEMPLATE_LIBRARY_COPY[locale].timeline;
  const seconds = duration ?? shots.at(-1)?.end;
  const meta = [
    shots.length > 0 ? fillCount(copy.shots, shots.length) : null,
    seconds ? `${seconds}s` : null,
    aspectRatio ?? null,
  ].filter(Boolean).join(" · ");
  const span = shots.at(-1)?.end ?? 0;
  const marks = shots.length > 0 ? [0, ...shots.map((shot) => shot.end)] : [];
  /// 秒刻度：每秒一根，节拍分界处加长；只在整秒且不超过一分钟时画，免得刻度糊成一片
  const ticks = Number.isInteger(span) && span > 0 && span <= 60 ? Array.from({ length: span + 1 }, (_, second) => second) : [];

  return (
    <div className="x-well absolute inset-0 flex flex-col justify-between gap-3 border-0 p-4">
      <div className="flex items-center justify-between gap-3">
        <MonoTag>{copy.pending}</MonoTag>
        <span className="truncate font-mono text-data tabular-nums text-tertiary">{meta}</span>
      </div>
      {shots.length > 0 ? (
        <div className="space-y-1.5">
          <ol aria-label={copy.label} className="flex gap-1">
            {shots.map((shot) => (
              <li
                key={`${shot.start}-${shot.end}`}
                className="flex min-w-0 basis-0 flex-col gap-3 rounded-(--radius-sm) border border-border bg-raised px-2 py-1.5"
                style={{ flexGrow: shot.end - shot.start }}
              >
                <span className="truncate text-meta text-foreground">{copy.beats[shot.beat] ?? shot.beat}</span>
                <span className="font-mono text-micro tabular-nums text-muted-foreground">{shot.end - shot.start}s</span>
              </li>
            ))}
          </ol>
          <div aria-hidden className="relative h-5">
            {ticks.length > 0 ? (
              <div className="absolute inset-x-0 top-0 flex items-start justify-between">
                {ticks.map((second) => (
                  <span
                    key={second}
                    className={cn("w-px", marks.includes(second) ? "h-1.5 bg-border-bright" : "h-1 bg-border-strong")}
                  />
                ))}
              </div>
            ) : null}
            {marks.map((second, index) => (
              <span
                key={second}
                /// 不走 cn：未配置的 twMerge 会把 text-micro 当成颜色、被 text-tertiary 吞掉
                className={`absolute top-2 font-mono text-micro tabular-nums text-tertiary ${
                  index === 0 ? "" : index === marks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
                }`}
                style={{ left: `${(second / span) * 100}%` }}
              >
                {second}s
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-meta text-tertiary">{copy.none}</p>
      )}
    </div>
  );
}
