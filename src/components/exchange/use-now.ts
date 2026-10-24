"use client";

import { useSyncExternalStore } from "react";

/*
 * 秒级时钟的唯一来源：所有挂着的时钟共用一个 1s 定时器。
 * 服务端快照为 null（渲染占位），订阅时才取当前时间，避免水合不一致。
 */
const listeners = new Set<() => void>();
let current: number | null = null;
let timer: number | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    current = Date.now();
    timer = window.setInterval(() => {
      current = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
