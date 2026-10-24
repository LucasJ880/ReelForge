import { cn } from "@/lib/utils";

/**
 * 品牌标记：一枚行情「上涨 tick」▲，中间一道横切把它刻成字母 A。
 * 深色底块 + 信号青的标记本体；不再用胶片 / 场记板意象。
 */
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
        "inline-flex shrink-0 items-center justify-center rounded-(--radius-md) border border-border-bright bg-raised text-accent",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="currentColor">
        <path
          fillRule="evenodd"
          d="M12 2.6 21.8 20.6H2.2L12 2.6Zm-4.62 11.6h9.24l.86 1.6H6.52l.86-1.6Z"
        />
      </svg>
    </span>
  );
}
