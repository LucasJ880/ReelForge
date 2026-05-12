"use client";

import { Badge } from "@/components/ui/badge";
import type { ClientBrief } from "@/lib/schemas/client-brief";
import { useTranslation } from "@/i18n/useTranslation";

export function WizardBriefSummary({
  brief,
  selectedCardTitle,
  status,
}: {
  brief: ClientBrief | null;
  selectedCardTitle?: string | null;
  status?: string;
}) {
  const { t } = useTranslation();
  if (!brief) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        {t("wizard.summary.briefMissing")}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-white/10 bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base font-semibold tracking-tight">
            {brief.businessName}
          </div>
          <div className="text-xs text-muted-foreground">
            {labelFor(t, "industry", brief.industry)} ·{" "}
            {labelFor(t, "objective", brief.objective)} ·{" "}
            {brief.videoLengthSec}s ·{" "}
            {labelFor(t, "brandTone", brief.brandTone)}
          </div>
        </div>
        {status && (
          <Badge variant="outline" className="border-white/20 text-[10px]">
            {status}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {brief.targetPlatforms.map((p) => (
          <Badge
            key={p}
            variant="secondary"
            className="text-[10px] bg-white/5 border-white/10"
          >
            {labelFor(t, "platform", p)}
          </Badge>
        ))}
        {selectedCardTitle && (
          <Badge className="text-[10px] bg-emerald-500/15 border-emerald-400/30 text-emerald-200 border">
            {t("wizard.summary.referenceDirection", {
              title: selectedCardTitle,
            })}
          </Badge>
        )}
      </div>
      {brief.keyMessage && (
        <p className="text-xs text-muted-foreground italic">
          “{brief.keyMessage}”
        </p>
      )}
    </div>
  );
}

/**
 * 安全 i18n 取值：industry / objective / platform / brandTone 都有对应 namespace；
 * 找不到 key 时回退原始 enum 字符串，避免 UI 显示空白。
 */
function labelFor(
  t: (key: string, params?: Record<string, string | number>) => string,
  ns: "industry" | "objective" | "platform" | "brandTone",
  key: string,
): string {
  const fullKey = `${ns}.${key}`;
  const translated = t(fullKey);
  /// translator 在 key 缺失时返回 fullKey；用这个判定是否回退
  if (translated === fullKey) return key;
  return translated;
}
