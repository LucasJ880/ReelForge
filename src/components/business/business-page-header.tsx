import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BusinessPageHeaderProps {
  kicker?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * B 端统一页头：kicker + 标题 + 副标题 + 可选主操作。
 */
export function BusinessPageHeader({
  kicker,
  title,
  subtitle,
  action,
  className,
}: BusinessPageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-white/10 pb-8 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {kicker ? (
          <p className="text-xs font-medium uppercase tracking-wider text-primary/90">
            {kicker}
          </p>
        ) : null}
        <h1
          className={cn(
            "font-semibold tracking-tight text-3xl",
            kicker ? "mt-2" : "",
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
