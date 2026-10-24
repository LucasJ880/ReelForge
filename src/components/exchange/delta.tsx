import { TickGlyph } from "@/components/exchange/status-tick";
import { cn } from "@/lib/utils";

/**
 * 涨跌：和上一个同长窗口比。三角指方向，颜色说好坏（失败数涨是坏事，upIsGood=false）。
 * 持平写「持平」，不画箭头。
 */
export function Delta({
  current,
  previous,
  label,
  flatLabel,
  upIsGood = true,
  className,
}: {
  current: number;
  previous: number;
  label: string;
  flatLabel: string;
  upIsGood?: boolean;
  className?: string;
}) {
  const diff = current - previous;
  if (diff === 0) {
    return <span className={cn("text-muted-foreground", className)}>{flatLabel} · {label}</span>;
  }
  const good = diff > 0 === upIsGood;
  return (
    <span className={cn("inline-flex items-center gap-1.5 tabular-nums", good ? "text-success" : "text-danger", className)}>
      <TickGlyph tone={diff > 0 ? "live" : "fault"} />
      {Math.abs(diff)}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
