import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EditorialStep {
  id: string;
  title: string;
  description?: string;
}

export function EditorialStepper({
  steps,
  currentIndex,
  className,
}: {
  steps: EditorialStep[];
  currentIndex: number;
  className?: string;
}) {
  return (
    <ol className={cn("relative space-y-0", className)} aria-label="创作步骤">
      {steps.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isLast = index === steps.length - 1;

        return (
          <li key={step.id} className="relative flex gap-4 pb-8 last:pb-0">
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[15px] top-8 bottom-0 w-px",
                  isComplete ? "bg-success" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-meta font-semibold",
                isComplete && "border-success bg-success text-card",
                isCurrent && "border-primary bg-accent-soft text-foreground",
                !isComplete && !isCurrent && "border-border bg-card text-muted-foreground",
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              {isComplete ? <Check className="size-4" aria-hidden /> : index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p
                className={cn(
                  "text-meta font-medium",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.title}
              </p>
              {step.description ? (
                <p className="mt-1 text-meta text-muted-foreground">
                  {step.description}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
