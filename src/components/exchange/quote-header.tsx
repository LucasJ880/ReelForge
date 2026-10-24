import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuoteTone = "neutral" | "live" | "filled" | "winner" | "fault" | "ai";

export type QuoteStat = {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: QuoteTone;
  /** 这一格指向哪里（成品库的生产线读数）：整格可点，用拉伸链接实现，dl 结构不变。 */
  href?: string;
};

const TONE: Record<QuoteTone, string> = {
  neutral: "text-foreground",
  live: "text-accent",
  filled: "text-success",
  winner: "text-gold",
  fault: "text-danger",
  ai: "text-iris",
};

const WALL_COLUMNS: Record<number, string> = {
  2: "",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "sm:grid-cols-3 lg:grid-cols-6",
};

export type QuoteHeaderProps = {
  /** 标题：工作区页面一律是导航名（用 WorkspacePage 传 nav）；详情页是这一条的名字。 */
  title: React.ReactNode;
  /** 副标题：口号 + 一句说明，限宽 62ch。 */
  subtitle?: React.ReactNode;
  /** 标题下的状态 / 元信息行（详情页：状态记号、时长、编号）。 */
  meta?: React.ReactNode;
  /**
   * 主行动：一页一枚实心主钮。没有主行动也要显式写 `null`——
   * 「右侧主行动」之前只在 2/11 页成立，就是因为这个位置可以随手不写。
   */
  primaryAction: React.ReactNode | null;
  /** 次要行动（描边 / 幽灵钮），排在主行动左侧。 */
  secondaryActions?: React.ReactNode;
  /** 模式切换（视频 / 产品图）：和行动分开放，不占主行动的位置。 */
  modeSwitch?: React.ReactNode;
  /** 读数墙：真实数字，零就写零；取不到写「—」，不放示例数字。 */
  readings: QuoteStat[];
  readingsLabel: string;
  /** 统计口径：一行写清楚这些数数的是什么。必填。 */
  scope: React.ReactNode;
  className?: string;
};

/**
 * 行情头：每个工作区页面的开场。大而轻的标题 + 一面读数墙 + 一行统计口径。
 * 主行动 / 次要行动 / 模式切换各有插槽；不加眉题，标题自己承重。
 */
export function QuoteHeader({
  title,
  subtitle,
  meta,
  primaryAction,
  secondaryActions,
  modeSwitch,
  readings,
  readingsLabel,
  scope,
  className,
}: QuoteHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions);
  return (
    <header className={cn("space-y-6", className)} data-quote-header>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-4xl space-y-3">
          <h1 className="x-display">{title}</h1>
          {meta ? <div className="text-meta text-muted-foreground">{meta}</div> : null}
          {subtitle ? <p className="max-w-[62ch] text-body text-muted-foreground text-pretty">{subtitle}</p> : null}
        </div>
        {modeSwitch || hasActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {modeSwitch ? <div data-slot="mode-switch">{modeSwitch}</div> : null}
            {hasActions ? (
              <div data-slot="actions" className="flex flex-wrap items-center gap-2">
                {secondaryActions}
                {primaryAction}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        {readings.length > 0 ? (
          <dl
            aria-label={readingsLabel}
            className={cn("x-wall x-frame grid-cols-2 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2", WALL_COLUMNS[readings.length] ?? "lg:grid-cols-4")}
          >
            {readings.map((stat) => (
              <div
                key={stat.label}
                className={cn(
                  "relative flex min-w-0 flex-col gap-2.5 px-5 py-4",
                  stat.href && "group transition-colors duration-fast ease-out hover:bg-raised focus-within:bg-raised motion-reduce:transition-none",
                )}
              >
                <dt className="x-label flex items-center justify-between gap-3">
                  {stat.href ? (
                    <Link
                      href={stat.href}
                      className="truncate after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                    >
                      {stat.label}
                    </Link>
                  ) : (
                    <span className="truncate">{stat.label}</span>
                  )}
                  {stat.href ? (
                    <ArrowRight className="size-3.5 shrink-0 text-tertiary transition-colors group-hover:text-accent" aria-hidden />
                  ) : null}
                </dt>
                <dd className={cn("x-figure truncate", TONE[stat.tone ?? "neutral"])}>{stat.value}</dd>
                {stat.caption ? <dd className="truncate text-meta text-muted-foreground">{stat.caption}</dd> : null}
              </div>
            ))}
          </dl>
        ) : null}
        <p className="font-mono text-data text-tertiary text-pretty" data-slot="scope">{scope}</p>
      </div>
    </header>
  );
}
