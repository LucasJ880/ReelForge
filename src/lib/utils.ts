import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tokens.css 里自定义的字号（text-data / text-meta / …）必须告诉 tailwind-merge，
 * 否则它把这些类当成文字颜色，遇到后面的 text-accent 之类就整个丢掉——
 * StatusTick、Badge、按钮等的字号会悄悄退回继承值。
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "data", "meta", "body", "subhead", "title", "section", "figure"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatDateShort(date: Date | string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatNumber(num: number | null | undefined): string {
  if (num == null) return "—";
  if (num >= 10000) {
    return `${(num / 10000).toFixed(1)}万`;
  }
  return num.toLocaleString("zh-CN");
}

export function formatPercent(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
