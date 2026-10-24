"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * 询盘时间：按访问者本机时区显示「月-日 时:分」（不是今年再带年份）。
 * 服务端只传 ISO，先渲染占位，水合后才换成本地时间（与 LocalTime 同一做法，避免水合不一致）。
 */
export function LeadTime({ iso, locale, className }: { iso: string; locale: string; className?: string }) {
  const text = useSyncExternalStore(
    noop,
    () => {
      const date = new Date(iso);
      const sameYear = date.getFullYear() === new Date().getFullYear();
      return new Intl.DateTimeFormat(locale, {
        ...(sameYear ? {} : { year: "numeric" }),
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    },
    () => null,
  );
  return (
    <time dateTime={iso} className={className}>
      {text ?? "--/-- --:--"}
    </time>
  );
}
