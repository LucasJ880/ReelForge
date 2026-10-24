import { cn } from "@/lib/utils";

/**
 * 区块抬头：标题 + 等宽计数 + 右侧一句说明与行动。不加眉题。
 * 说明与行动并成一组贴右（1025 · B2）：三个兄弟节点 justify-between 时，说明会被挤到中间。
 */
export function SectionHead({
  title,
  count,
  countTone = "neutral",
  hint,
  action,
  className,
}: {
  title: React.ReactNode;
  count?: number;
  countTone?: "neutral" | "live" | "winner" | "fault";
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-border pb-2", className)}>
      <h2 className="flex items-baseline gap-2.5 text-subhead font-medium">
        {title}
        {count !== undefined ? (
          <span
            className={cn(
              "font-mono text-data tabular-nums",
              countTone === "live" && "text-accent",
              countTone === "winner" && "text-gold",
              countTone === "fault" && "text-danger",
              countTone === "neutral" && "text-muted-foreground",
            )}
          >
            {count}
          </span>
        ) : null}
      </h2>
      {hint || action ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto sm:justify-end">
          {hint ? <p className="min-w-0 text-meta text-muted-foreground sm:text-right">{hint}</p> : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
