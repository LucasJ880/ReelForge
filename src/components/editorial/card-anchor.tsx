import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function CardAnchor({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-(--radius-md) border border-border bg-accent-soft text-foreground",
        className,
      )}
      aria-hidden={label ? undefined : true}
      title={label}
    >
      <Icon className="size-5 stroke-[1.5]" />
    </span>
  );
}
