import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
        "flex min-w-0 flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 max-w-3xl flex-1 space-y-3">
        {backLink ? (
          <Link
            href={backLink.href}
            className="inline-flex items-center gap-2 text-meta text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground motion-reduce:transition-none"
          >
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
            {backLink.label}
          </Link>
        ) : null}
        {kicker ? (
          <Badge variant="default">
            {kicker}
          </Badge>
        ) : null}
        <h1 className="editorial-display">{title}</h1>
        {meta ? <div>{meta}</div> : null}
        {subtitle ? (
          <p className="max-w-2xl text-body text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className="w-full shrink-0 sm:w-auto">{action}</div> : null}
    </header>
  );
}
