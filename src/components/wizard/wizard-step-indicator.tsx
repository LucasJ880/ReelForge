"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardStep {
  id: number;
  label: string;
  href: string;
  done?: boolean;
}

/**
 * 根据 pathname 推断当前 wizard step。
 * 纯函数 + 无 React 依赖，便于单测。
 *
 * 规则：
 * - /wizard/<id>            → 1
 * - /wizard/<id>/step-2-card → 2
 * - /wizard/<id>/step-3-script → 3
 * - /wizard/<id>/step-4-storyboard → 4
 * - /wizard/<id>/step-5-upload → 5
 * - /wizard/<id>/step-6-render → 6
 * - 其它（含 /wizard, /wizard/new）→ 0
 */
export function inferWizardStepFromPathname(pathname: string | null): number {
  if (!pathname) return 0;
  /// 命中具体 step 子路径
  const stepMatch = pathname.match(/\/wizard\/[^/]+\/step-(\d)-/);
  if (stepMatch) {
    const n = Number(stepMatch[1]);
    if (n >= 2 && n <= 6) return n;
  }
  /// /wizard/<id> 根（排除 reserved 段：new）
  const rootMatch = pathname.match(/^\/wizard\/([^/]+)\/?$/);
  if (rootMatch && rootMatch[1] !== "new") {
    return 1;
  }
  return 0;
}

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
  const resolvedCurrent =
    typeof currentStep === "number" && currentStep > 0
      ? currentStep
      : inferWizardStepFromPathname(pathname);
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Wizard steps">
      {steps.map((step) => {
        const isCurrent = step.id === resolvedCurrent;
        const isDone = !!step.done && !isCurrent;
        const accessible = isStepAccessible(step, resolvedCurrent);
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
            <span className="whitespace-nowrap">{step.label}</span>
          </div>
        );
        if (!accessible) {
          return (
            <div
              key={step.id}
              role="button"
              aria-disabled
              title="完成前置 step 后即可访问"
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

export function buildWizardSteps(
  orderId: string,
  flags: {
    cardSelected?: boolean;
    scriptReady?: boolean;
    storyboardReady?: boolean;
    assetsReady?: boolean;
    renderReady?: boolean;
  },
): WizardStep[] {
  return [
    { id: 1, label: "项目目标", href: `/wizard/${orderId}`, done: true },
    {
      id: 2,
      label: "选证据卡",
      href: `/wizard/${orderId}/step-2-card`,
      done: !!flags.cardSelected,
    },
    {
      id: 3,
      label: "AI 脚本",
      href: `/wizard/${orderId}/step-3-script`,
      done: !!flags.scriptReady,
    },
    {
      id: 4,
      label: "分镜 + 拍摄指导",
      href: `/wizard/${orderId}/step-4-storyboard`,
      done: !!flags.storyboardReady,
    },
    {
      id: 5,
      label: "上传素材 + QA",
      href: `/wizard/${orderId}/step-5-upload`,
      done: !!flags.assetsReady,
    },
    {
      id: 6,
      label: "Draft 渲染",
      href: `/wizard/${orderId}/step-6-render`,
      done: !!flags.renderReady,
    },
  ];
}
