import type { TranslationKey } from "@/i18n/types";

/**
 * Wizard step descriptor — pure data, server-safe (no React, no `"use client"`).
 *
 * 拆分自 wizard-step-indicator.tsx：之前 server component (layout) 直接 import
 * 一个标了 `"use client"` 的模块的 utility 函数会触发 SSR/CSR 边界告警，
 * 这里把纯数据函数 + 类型抽到独立模块，client 与 server 两端都可安全引用。
 */

export interface WizardStep {
  id: number;
  /// i18n key for the step label — UI 端用 useTranslation/getServerTranslator 解析
  labelKey: TranslationKey;
  href: string;
  done?: boolean;
}

/**
 * 根据 pathname 推断当前 wizard step。
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
  const stepMatch = pathname.match(/\/wizard\/[^/]+\/step-(\d)-/);
  if (stepMatch) {
    const n = Number(stepMatch[1]);
    if (n >= 2 && n <= 6) return n;
  }
  const rootMatch = pathname.match(/^\/wizard\/([^/]+)\/?$/);
  if (rootMatch && rootMatch[1] !== "new") {
    return 1;
  }
  return 0;
}

export interface WizardProgressFlags {
  cardSelected?: boolean;
  scriptReady?: boolean;
  storyboardReady?: boolean;
  assetsReady?: boolean;
  renderReady?: boolean;
}

export function buildWizardSteps(
  orderId: string,
  flags: WizardProgressFlags,
): WizardStep[] {
  return [
    {
      id: 1,
      labelKey: "wizard.step.kickoff",
      href: `/wizard/${orderId}`,
      done: true,
    },
    {
      id: 2,
      labelKey: "wizard.step.creative",
      href: `/wizard/${orderId}/step-2-card`,
      done: !!flags.cardSelected,
    },
    {
      id: 3,
      labelKey: "wizard.step.script",
      href: `/wizard/${orderId}/step-3-script`,
      done: !!flags.scriptReady,
    },
    {
      id: 4,
      labelKey: "wizard.step.storyboard",
      href: `/wizard/${orderId}/step-4-storyboard`,
      done: !!flags.storyboardReady,
    },
    {
      id: 5,
      labelKey: "wizard.step.assets",
      href: `/wizard/${orderId}/step-5-upload`,
      done: !!flags.assetsReady,
    },
    {
      id: 6,
      labelKey: "wizard.step.render",
      href: `/wizard/${orderId}/step-6-render`,
      done: !!flags.renderReady,
    },
  ];
}
