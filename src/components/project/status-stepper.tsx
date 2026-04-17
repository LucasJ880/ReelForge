"use client";

import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";

const steps = [
  { key: "content", label: "内容" },
  { key: "video", label: "视频" },
  { key: "done", label: "完成" },
];

const statusToStep: Record<string, number> = {
  DRAFT: 0,
  CONTENT_GENERATED: 1,
  VIDEO_GENERATING: 1,
  VIDEO_FAILED: 1,
  VIDEO_READY: 2,
  DONE: 3,
};

const loadingStatuses = new Set(["VIDEO_GENERATING"]);

export function StatusStepper({ status }: { status: string }) {
  const currentStep = statusToStep[status] ?? 0;
  const isLoading = loadingStatuses.has(status);

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        const activeLoading = active && isLoading;

        return (
          <div key={step.key} className="flex items-center gap-1">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium transition-colors",
                  done && "bg-emerald-500 text-white",
                  active && !activeLoading && "bg-primary text-white",
                  activeLoading && "bg-amber-500 text-white",
                  !done && !active && "bg-secondary text-muted-foreground"
                )}
              >
                {done ? (
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                ) : activeLoading ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={cn(
                  "text-[11px] hidden sm:inline",
                  done ? "text-muted-foreground" : active ? "text-foreground font-medium" : "text-muted-foreground/70"
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "h-px w-4 lg:w-6",
                  i < currentStep ? "bg-emerald-400" : "bg-muted-foreground/40"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
