import { cn } from "@/lib/utils";

export function Logo({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#c026d3" />
        </linearGradient>
        <linearGradient id="logo-spark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e879f9" />
          <stop offset="100%" stopColor="#f9a8d4" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#logo-bg)" />
      {/* Play triangle */}
      <path
        d="M16 12.5V27.5L28 20L16 12.5Z"
        fill="white"
        fillOpacity="0.95"
      />
      {/* Spark accent */}
      <circle cx="30" cy="11" r="2.5" fill="url(#logo-spark)" />
      <circle cx="33" cy="15" r="1.2" fill="url(#logo-spark)" opacity="0.6" />
    </svg>
  );
}
