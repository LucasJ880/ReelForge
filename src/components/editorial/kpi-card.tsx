import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  progress,
  hint,
  className,
}: {
  label: string;
  value: string | number;
  progress?: number;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-(--radius-lg) border border-border bg-card p-4 shadow-editorial",
        className,
      )}
    >
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-subhead tabular-nums text-foreground">
        {value}
      </p>
      {typeof progress === "number" ? (
        <div className="mt-3 space-y-1">
          <Progress value={progress} aria-label={`${label} 进度 ${progress}%`} />
          {hint ? <p className="text-meta text-muted-foreground">{hint}</p> : null}
        </div>
      ) : hint ? (
        <p className="mt-2 text-meta text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
