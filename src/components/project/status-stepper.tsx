"use client";

import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";

const steps = [
  { key: "content", label: "内容生成" },
  { key: "video", label: "视频生成" },
  { key: "publish", label: "发布" },
  { key: "analytics", label: "数据分析" },
];

const statusToStep: Record<string, number> = {
  DRAFT: 0,
  CONTENT_GENERATED: 1,
  VIDEO_GENERATING: 1,
  VIDEO_FAILED: 1,
  VIDEO_READY: 2,
  PUBLISHING: 2,
  PUBLISH_FAILED: 2,
  PUBLISHED: 3,
  ANALYTICS_PENDING: 3,
  ANALYTICS_FETCHED: 3,
  ANALYZED: 4,
};

const loadingStatuses = new Set([
  "VIDEO_GENERATING",
  "PUBLISHING",
  "ANALYTICS_PENDING",
]);

export function StatusStepper({ status }: { status: string }) {
  const currentStep = statusToStep[status] ?? 0;
  const isLoading = loadingStatuses.has(status);

  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        const activeLoading = active && isLoading;

        return (
          <div key={step.key} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors",
                  done && "bg-green-500 text-white",
                  active && !activeLoading && "bg-black text-white",
                  activeLoading && "bg-yellow-500 text-white",
                  !done && !active && "bg-gray-200 text-gray-500"
                )}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : activeLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={cn(
                  "text-sm hidden sm:inline",
                  (done || active) ? "text-gray-900 font-medium" : "text-gray-400"
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "h-px w-6 md:w-10",
                  i < currentStep ? "bg-green-500" : "bg-gray-200"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
