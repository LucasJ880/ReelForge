import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BusinessPageHeaderProps {
  kicker?: string;
  title: string;
  subtitle?: string;
  /** 状态徽章、规格等，显示在标题下方 */
  meta?: ReactNode;
  backLink?: { href: string; label: string };
  action?: ReactNode;
  className?: string;
}

/**
 * B 端统一页头：返回链接 + kicker + 标题 + 副标题/元信息 + 可选主操作。
 */
export function BusinessPageHeader({
  kicker,
  title,
  subtitle,
  meta,
  backLink,
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
      <div className="min-w-0 flex-1">
        {backLink ? (
          <Link
            href={backLink.href}
            className="inline-flex text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {backLink.label}
          </Link>
        ) : null}
        {kicker ? (
          <p
            className={cn(
              "text-xs font-medium uppercase tracking-wider text-primary/90",
              backLink ? "mt-3" : "",
            )}
          >
            {kicker}
          </p>
        ) : null}
        <h1
          className={cn(
            "font-semibold tracking-tight text-3xl",
            kicker || backLink ? "mt-2" : "",
          )}
        >
          {title}
        </h1>
        {meta ? <div className="mt-3">{meta}</div> : null}
        {subtitle ? (
          <p
            className={cn(
              "max-w-2xl text-sm leading-relaxed text-muted-foreground",
              meta ? "mt-2" : "mt-2",
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
