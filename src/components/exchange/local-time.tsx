"use client";

import { useSyncExternalStore } from "react";

/**
 * 时间一律按访问者本机时区显示（1025 · B1.7）。服务端只传 ISO，先渲染占位，
 * 水合后才换成本地时间——服务器（Vercel 是 UTC）与浏览器时区不同也不会水合不一致。
 *
 * 四种写法，全站只用这四种：
 *   time      HH:mm（只在明确是「今天」的场合用，比如时钟旁）
 *   datetime  今天 → HH:mm；非今天 → 月日 HH:mm；非今年 → 年月日 HH:mm（成交带、表格「更新时间」）
 *   date      今天 → 今天；非今天 → 月日；非今年 → 年月日（卡片上的日期）
 *   relative  刚刚 / 5 分钟前 / 3 小时前 / 2 天前；超过 7 天退回 date
 */
export type LocalTimeVariant = "time" | "datetime" | "date" | "relative";

const PLACEHOLDER: Record<LocalTimeVariant, string> = {
  time: "--:--",
  datetime: "--:--",
  date: "--",
  relative: "--",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* 所有挂着的时间共用一个 30 秒节拍：「今天」跨午夜、相对时间往前走时跟着换。
 * 快照是字符串，没变就不重渲染。 */
const listeners = new Set<() => void>();
let timer: number | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    timer = window.setInterval(() => listeners.forEach((notify) => notify()), 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function today(locale: string): string {
  return locale === "en-US" ? "Today" : "今天";
}

/** 纯函数：给测试与服务端校验用。now 与 at 都按运行环境的本地时区解读。 */
export function formatLocalTime(iso: string, locale: string, variant: LocalTimeVariant, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return PLACEHOLDER[variant];
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const isToday = sameDay(at, now);
  const thisYear = at.getFullYear() === now.getFullYear();
  const day = new Intl.DateTimeFormat(locale, thisYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" }).format(at);

  if (variant === "time") return clock;
  if (variant === "datetime") return isToday ? clock : `${day} ${clock}`;
  if (variant === "date") return isToday ? today(locale) : day;

  const ago = now.getTime() - at.getTime();
  if (ago < MINUTE && ago > -MINUTE) return locale === "en-US" ? "Just now" : "刚刚";
  if (ago < 0 || ago >= 7 * DAY) return isToday ? clock : day;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (ago < HOUR) return relative.format(-Math.floor(ago / MINUTE), "minute");
  if (ago < DAY) return relative.format(-Math.floor(ago / HOUR), "hour");
  return relative.format(-Math.floor(ago / DAY), "day");
}

export function LocalTime({
  iso,
  locale,
  variant = "datetime",
  className,
}: {
  iso: string;
  locale: string;
  variant?: LocalTimeVariant;
  className?: string;
}) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatLocalTime(iso, locale, variant),
    () => null,
  );
  return (
    <time dateTime={iso} className={className}>
      {text ?? PLACEHOLDER[variant]}
    </time>
  );
}
