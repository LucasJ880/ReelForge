"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 会跳的读数：大屏每 30 秒刷新带来新值时闪一次（涨=成交绿、跌=玫红），像行情跳动。
 * 首屏不闪；减少动态时只换数不闪。
 */
export function TickerFigure({
  value,
  children,
  className,
}: {
  value: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const [last, setLast] = useState(value);
  const [move, setMove] = useState<"up" | "down" | null>(null);
  if (value !== last) {
    setLast(value);
    setMove(value > last ? "up" : "down");
  }
  return (
    <span key={value} data-move={move ?? undefined} className={cn("x-ticker", className)}>
      {children ?? value}
    </span>
  );
}
