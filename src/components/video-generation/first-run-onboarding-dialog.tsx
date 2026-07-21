"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const STEPS_ZH: Array<{ title: string; body: string }> = [
  { title: "添加产品参考图（可选，推荐）", body: "真实产品图会作为一致性参考，让风格与产品更稳。" },
  { title: "选生成方式与视频规格", body: "第一次用快速生成即可，推荐值已替你锁好。" },
  { title: "写清想拍什么，核对后生成", body: "提交后可在成品库跟踪进度，成片自动入库。" },
];
const STEPS_EN: Array<{ title: string; body: string }> = [
  { title: "Add product references (optional, recommended)", body: "Real product images anchor style and product consistency." },
  { title: "Pick a generation mode and specs", body: "Quick mode ships with recommended values already locked in." },
  { title: "Describe the video, review, and generate", body: "Track progress in the library; finished videos land there automatically." },
];

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
  if (!open) return null;
  const steps = english ? STEPS_EN : STEPS_ZH;
  return (
    <div
      data-testid="first-run-onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
    >
      <div className="w-full max-w-lg space-y-4 rounded-(--radius-lg) border border-border bg-card p-6 shadow-editorial">
        <p className="inline-flex rounded-full border border-border bg-accent-soft px-3 py-0.5 text-meta text-foreground">
          {english ? "First visit · Create studio" : "第一次使用 · 创作工作台"}
        </p>
        <h2 id="first-run-onboarding-title" className="font-heading text-title font-semibold">
          {english ? "Three steps to your first video" : "3 步出第一条成片"}
        </h2>
        <p className="text-meta text-muted-foreground">
          {english
            ? "Recommended values are pre-set. Finish the main flow first; advanced settings can wait."
            : "系统已替你锁好推荐值，先跑通主流程；进阶设置以后再说。"}
        </p>
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3 rounded-(--radius-md) border border-border bg-background p-3">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-meta tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-body font-medium text-foreground">{step.title}</span>
                <span className="block text-meta text-muted-foreground">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => onKeepHintsChange(!keepHints)}
            aria-pressed={keepHints}
            className="flex items-center gap-2 text-meta text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span
              aria-hidden
              className={`flex size-4 items-center justify-center rounded-(--radius-sm) border ${keepHints ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent"}`}
            >
              <Check className="size-3" />
            </span>
            {english ? "Keep short hints on the page" : "在页面保留简短的新手提示"}
          </button>
          <span className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onSkip}>
              {english ? "Skip" : "跳过"}
            </Button>
            <Button type="button" onClick={onStart}>
              {english ? "Start creating" : "开始创作"}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
