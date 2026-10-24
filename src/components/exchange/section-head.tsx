import { cn } from "@/lib/utils";

/** 区块抬头：标题 + 等宽计数 + 右侧一句说明。不加眉题。 */
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
      {hint ? <p className="text-meta text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}
