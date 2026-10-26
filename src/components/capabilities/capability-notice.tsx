import Link from "next/link";
import { TickGlyph, tickToneClass } from "@/components/exchange/status-tick";
import type { Locale } from "@/i18n/config";
import {
  featureGate,
  type FeatureGate,
  type FeatureKey,
  type PublicCapabilities,
} from "@/lib/capabilities/registry";
import { cn } from "@/lib/utils";

/**
 * C4 · 细通知：这一页依赖的功能里，有哪些因为能力暂停 / 未开通被挡住了，每条一句人话
 * （说清楚系统改用什么），尾部一个去「能力状态」页的链接。全部正常时什么都不渲染。
 *
 * 纯展示组件（不引服务端模块、不用 hook）：server page 与 'use client' 组件都能用。
 * 颜色只给数据：暂停 = 失败记号（玫红），与状态页的 StatusTick 同一套。
 */
export function blockedFeatureGates(
  capabilities: PublicCapabilities | null | undefined,
  features: readonly FeatureKey[],
): FeatureGate[] {
  return features
    .map((feature) => featureGate(capabilities, feature))
    .filter((gate) => gate.status === "blocked" && gate.message !== null);
}

export function CapabilityNotice({
  capabilities,
  features,
  locale,
  linkLabel,
  className,
  testId = "capability-notice",
}: {
  capabilities: PublicCapabilities | null | undefined;
  features: readonly FeatureKey[];
  locale: Locale;
  /** 去状态页的链接文字；不传就不放链接（比如卡片内部已经很挤） */
  linkLabel?: string;
  className?: string;
  testId?: string;
}) {
  const gates = blockedFeatureGates(capabilities, features);
  if (gates.length === 0) return null;
  return (
    <div
      role="status"
      data-testid={testId}
      data-blocked-features={gates.map((gate) => gate.feature).join(" ")}
      className={cn(
        "flex flex-col gap-2 rounded-(--radius-md) border border-border bg-raised px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        className,
      )}
    >
      <ul className="min-w-0 space-y-1.5">
        {gates.map((gate) => (
          <li key={gate.feature} className="flex items-start gap-2 text-meta text-foreground">
            <TickGlyph tone="fault" className={cn("mt-[0.3em]", tickToneClass("fault"))} />
            <span className="min-w-0 text-pretty">{gate.message?.[locale]}</span>
          </li>
        ))}
      </ul>
      {linkLabel ? (
        <Link
          href="/app/status"
          prefetch={false}
          className="shrink-0 self-start font-mono text-data uppercase tracking-wider text-accent hover:text-accent-strong"
        >
          {linkLabel} →
        </Link>
      ) : null}
    </div>
  );
}
