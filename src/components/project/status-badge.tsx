import { PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS } from "@/types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const label = PROJECT_STATUS_LABELS[status] || status;
  const colors = PROJECT_STATUS_COLORS[status] || "bg-zinc-100 text-zinc-600";

  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        colors,
        className
      )}
    >
      {label}
    </span>
  );
}
