import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PetSectionProps {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  /// 区块右上角附加内容（如标识 / 标签）
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 宠物 demo 通用区块外壳：统一的容器宽度、留白与标题排版。
 * 全部使用语义化 token，配合 Editorial Studio 语义 token呈现暖色风格。
 */
export function PetSection({
  id,
  eyebrow,
  title,
  description,
  aside,
  children,
  className,
}: PetSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {eyebrow}
          </p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h2>
          {description ? (
            <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}
