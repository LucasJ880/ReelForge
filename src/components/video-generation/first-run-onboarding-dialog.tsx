"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { cn } from "@/lib/utils";

/**
 * 首用引导（1025 · B2.8）：用共享 Dialog（Esc 关闭 = 跳过、焦点困在弹窗里、关闭后焦点回到原处），
 * 步骤与页内提示条、右栏「当前创作流程」同一个来源（platform-copy create.flowSteps）——
 * 之前弹窗写 3 步、提示条写 5 步、委托单编到 06，同一个流程三种步数。
 */
export function FirstRunOnboardingDialog({
  open,
  english,
  keepHints,
  onKeepHintsChange,
  onSkip,
  onStart,
}: {
  open: boolean;
  english: boolean;
  keepHints: boolean;
  onKeepHintsChange: (next: boolean) => void;
  onSkip: () => void;
  onStart: () => void;
}) {
  const create = getPlatformCopy(english ? "en-US" : "zh-CN").create;
  const steps = create.flowSteps;
  const copy = create.onboarding;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onSkip();
      }}
    >
      {/* 不透明浮层：popover 实底 + 浮空投影，不做模糊；标题自己承重，不加眉题 */}
      <DialogContent data-testid="first-run-onboarding" className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-title font-medium leading-tight">
            {copy.title.replace("{n}", String(steps.length))}
          </DialogTitle>
          <DialogDescription className="text-meta">{copy.body}</DialogDescription>
        </DialogHeader>
        <ol className="x-wall">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-4 px-4 py-3">
              <span className="x-label mt-1 shrink-0 tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0">
                <span className="block text-body font-medium text-foreground">{step.title}</span>
                <span className="mt-0.5 block text-meta text-muted-foreground">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <button
            type="button"
            onClick={() => onKeepHintsChange(!keepHints)}
            aria-pressed={keepHints}
            className="flex items-center gap-2 rounded-(--radius-sm) text-meta text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-4 items-center justify-center rounded-(--radius-sm) border",
                keepHints ? "border-(--accent-line) text-accent" : "border-border-strong text-transparent",
              )}
            >
              <Check className="size-3" />
            </span>
            {copy.keepHints}
          </button>
          <span className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onSkip}>
              {copy.skip}
            </Button>
            <Button type="button" onClick={onStart}>
              {copy.start}
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
