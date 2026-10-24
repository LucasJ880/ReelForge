import { cn } from "@/lib/utils";

/**
 * 中性等宽标签：给「样例」「草案」「攒样本」「样片待补」这类不是生产状态的说明。
 * 状态记号（StatusTick）只表达状态；这里不带记号、不带数据色，免得被读成「已成片 / 暂停」。
 */
export function MonoTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-(--radius-sm) border border-border px-1.5 py-0.5 font-mono text-micro uppercase leading-4 tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
