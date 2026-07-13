import { cn } from "@/lib/utils";
import { Clapperboard } from "lucide-react";

export function Logo({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-(--radius-md) border border-primary bg-primary text-primary-foreground",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Clapperboard
        width={size / 2}
        height={size / 2}
        strokeWidth={1.5}
      />
    </span>
  );
}
