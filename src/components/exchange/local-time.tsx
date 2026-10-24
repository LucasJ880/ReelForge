"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * 按访问者本机时区显示 HH:mm。服务端（UTC）先渲染占位，水合后才换成本地时间，
 * 避免服务端与浏览器时区不同造成的水合不一致。
 */
export function LocalTime({ iso, locale, className }: { iso: string; locale: string; className?: string }) {
  const text = useSyncExternalStore(
    noop,
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)),
    () => null,
  );
  return (
    <time dateTime={iso} className={className}>
      {text ?? "--:--"}
    </time>
  );
}
