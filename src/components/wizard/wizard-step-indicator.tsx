"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import {
  buildWizardSteps,
  inferWizardStepFromPathname,
  type WizardStep,
} from "./wizard-steps";

/// Re-export server-safe utilities so existing call sites (and tests) keep working.
export { buildWizardSteps, inferWizardStepFromPathname, type WizardStep };

/**
 * 已完成的 step 可点击；未到达且未完成的 step 禁用。
 */
function isStepAccessible(step: WizardStep, currentStep: number): boolean {
  if (step.id === currentStep) return true;
  if (step.id < currentStep) return true;
  return !!step.done;
}

export function WizardStepIndicator({
  steps,
  /// 可选 currentStep；缺省时由 pathname 自动推断（推荐）。
  currentStep,
}: {
  steps: WizardStep[];
  currentStep?: number;
}) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const resolvedCurrent =
    typeof currentStep === "number" && currentStep > 0
      ? currentStep
      : inferWizardStepFromPathname(pathname);
  return (
    <nav
      className="flex flex-wrap gap-2"
      aria-label={t("wizard.layout.stepsAriaLabel")}
    >
      {steps.map((step) => {
        const isCurrent = step.id === resolvedCurrent;
        const isDone = !!step.done && !isCurrent;
        const accessible = isStepAccessible(step, resolvedCurrent);
        const label = t(step.labelKey);
        const content = (
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs border",
              isCurrent &&
                "bg-foreground text-background border-foreground font-medium",
              !isCurrent && isDone && "bg-emerald-500/10 border-emerald-400/30 text-emerald-200",
              !isCurrent && !isDone && "border-white/10 text-muted-foreground",
              !accessible && "opacity-50 cursor-not-allowed",
            )}
            aria-current={isCurrent ? "step" : undefined}
            aria-disabled={!accessible || undefined}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                isCurrent && "bg-background text-foreground border-background",
                !isCurrent && isDone && "bg-emerald-500/20 border-emerald-400/40",
                !isCurrent && !isDone && "border-white/20",
              )}
            >
              {isDone ? <Check className="h-3 w-3" /> : step.id}
            </span>
            <span className="whitespace-nowrap">{label}</span>
          </div>
        );
        if (!accessible) {
          return (
            <div
              key={step.id}
              role="button"
              aria-disabled
              title={t("wizard.layout.stepLockedHint")}
            >
              {content}
            </div>
          );
        }
        return (
          <Link key={step.id} href={step.href}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
