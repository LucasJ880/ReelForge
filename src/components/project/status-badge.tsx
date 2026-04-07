import { Badge } from "@/components/ui/badge";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS } from "@/types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const label = PROJECT_STATUS_LABELS[status] || status;
  const colors = PROJECT_STATUS_COLORS[status] || "bg-gray-100 text-gray-700";

  return (
    <Badge variant="secondary" className={cn(colors, "font-medium", className)}>
      {label}
    </Badge>
  );
}
