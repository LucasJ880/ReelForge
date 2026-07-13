import { cn } from "@/lib/utils";

type FilmState = "completed" | "generating" | "queued" | "failed" | "cancelled";

const LABELS: Record<FilmState, string> = {
  completed: "已完成",
  generating: "生成中",
  queued: "排队中",
  failed: "失败",
  cancelled: "已取消",
};

export interface BatchFilmStripCounts {
  completed: number;
  generating: number;
  queued: number;
  failed: number;
  cancelled: number;
}

function stateAt(index: number, cellSize: number, counts: BatchFilmStripCounts): FilmState {
  const midpoint = index * cellSize + cellSize / 2;
  let cursor = counts.completed;
  if (midpoint <= cursor) return "completed";
  cursor += counts.generating;
  if (midpoint <= cursor) return "generating";
  cursor += counts.queued;
  if (midpoint <= cursor) return "queued";
  cursor += counts.failed;
  if (midpoint <= cursor) return "failed";
  return "cancelled";
}

export function BatchFilmStrip({
  counts,
  className,
  maxCells = 32,
}: {
  counts: BatchFilmStripCounts;
  className?: string;
  maxCells?: number;
}) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const cellSize = Math.max(1, Math.ceil(total / maxCells));
  const cellCount = Math.max(1, Math.ceil(total / cellSize));
  const summary = (Object.keys(LABELS) as FilmState[])
    .filter((state) => counts[state] > 0)
    .map((state) => `${LABELS[state]} ${counts[state]}`)
    .join("，");

  return (
    <div
      role="img"
      aria-label={total > 0 ? `批次状态分布：${summary}` : "批次状态分布：暂无任务"}
      className={cn("batch-film-strip", className)}
      style={{ gridTemplateColumns: `repeat(${cellCount}, minmax(0, 1fr))` }}
      data-cell-size={cellSize}
    >
      {Array.from({ length: cellCount }, (_, index) => {
        const state = total > 0 ? stateAt(index, cellSize, counts) : "queued";
        return (
          <span key={index} className="batch-film-cell" data-state={state} aria-hidden>
            <span className="batch-film-core" />
          </span>
        );
      })}
    </div>
  );
}
