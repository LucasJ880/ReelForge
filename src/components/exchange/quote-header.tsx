import { cn } from "@/lib/utils";

export type QuoteTone = "neutral" | "live" | "filled" | "winner" | "fault" | "ai";

export type QuoteStat = {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: QuoteTone;
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

/**
 * 行情头：每个工作区页面的开场。大而轻的标题 + 一面读数墙（真实数字，零就写零）。
 * 主行动放右侧；不加眉题，标题自己承重。
 */
export function QuoteHeader({
  title,
  subtitle,
  actions,
  stats,
  statsLabel,
  scope,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  stats?: QuoteStat[];
  statsLabel?: string;
  scope?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-6", className)}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-4xl space-y-3">
          <h1 className="x-display">{title}</h1>
          {subtitle ? <p className="max-w-[62ch] text-body text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {stats && stats.length > 0 ? (
        <div className="space-y-2">
          <dl
            aria-label={statsLabel}
            className={cn("x-wall x-frame grid-cols-2 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2", WALL_COLUMNS[stats.length] ?? "lg:grid-cols-4")}
          >
            {stats.map((stat) => (
              <div key={stat.label} className="flex min-w-0 flex-col gap-2.5 px-5 py-4">
                <dt className="x-label">{stat.label}</dt>
                <dd className={cn("x-figure truncate", TONE[stat.tone ?? "neutral"])}>{stat.value}</dd>
                {stat.caption ? <dd className="truncate text-meta text-muted-foreground">{stat.caption}</dd> : null}
              </div>
            ))}
          </dl>
          {scope ? <p className="font-mono text-data text-tertiary">{scope}</p> : null}
        </div>
      ) : null}
    </header>
  );
}
