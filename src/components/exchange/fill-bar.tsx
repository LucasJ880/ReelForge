import { cn } from "@/lib/utils";

export type FillCounts = {
  completed: number;
  running: number;
  paused: number;
  failed: number;
  cancelled: number;
};

/**
 * 分段成交条：一笔委托（批次）被哪些成片填满。
 * 成交=成交绿，生成中=信号青扫光，暂停=石板，失败=玫红，取消=斜纹，剩下的是排队空档。
 */
export function FillBar({
  counts,
  total,
  className,
  label,
}: {
  counts: FillCounts;
  total: number;
  className?: string;
  label?: string;
}) {
  const safeTotal = Math.max(total, 1);
  const segments = [
    { key: "completed", value: counts.completed, className: "bg-success" },
    { key: "running", value: counts.running, className: "x-seg-live" },
    { key: "paused", value: counts.paused, className: "bg-tertiary" },
    { key: "failed", value: counts.failed, className: "bg-danger" },
    { key: "cancelled", value: counts.cancelled, className: "x-hatch" },
  ].filter((segment) => segment.value > 0);
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("flex h-1.5 w-full gap-px overflow-hidden rounded-(--radius-sm) bg-sunken", className)}
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={cn("h-full", segment.className)}
          style={{ width: `${(segment.value / safeTotal) * 100}%` }}
        />
      ))}
    </div>
  );
}
