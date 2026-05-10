"use client";

import { Sparkles, Triangle } from "lucide-react";

/**
 * 用于在 step 3/4/6 顶部明确告诉客户：
 * - mock 脚本/分镜：还没有真 LLM 输出
 * - draft / mock render：当前不是真渲染
 *
 * Phase 2 边界要求：UI 必须清楚显示 Draft Preview / Mock Preview。
 */
export function WizardMockBanner({
  level,
  message,
}: {
  level: "info" | "warn";
  message: string;
}) {
  const isWarn = level === "warn";
  return (
    <div
      className={
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs " +
        (isWarn
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : "border-sky-500/30 bg-sky-500/10 text-sky-200")
      }
    >
      {isWarn ? (
        <Triangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      ) : (
        <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      )}
      <div>{message}</div>
    </div>
  );
}
