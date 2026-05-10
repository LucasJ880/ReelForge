import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DemoSectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  rightSlot?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function DemoSection({
  id,
  eyebrow,
  title,
  description,
  rightSlot,
  className,
  children,
}: DemoSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 lg:px-10",
        className,
      )}
    >
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div className="max-w-3xl">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          {description ? (
            <div className="mt-4 text-sm leading-7 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function SampleDataBadge({ label }: { label?: string } = {}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
      {label ?? "Sample data"}
    </span>
  );
}
