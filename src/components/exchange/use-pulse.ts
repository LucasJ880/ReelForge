"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PULSE_ENDPOINT,
  PULSE_INTERVAL_MS,
  PULSE_REFRESH_EVENT,
  type ExchangePulse,
} from "@/lib/exchange/pulse";

/** 连续的主动刷新（导航、提交）至少隔这么久，免得一次点击打两次接口。 */
const MIN_GAP_MS = 4_000;

/**
 * 壳层脉搏小岛：首屏用服务端值；页面可见时每 30 秒拉一次 /api/exchange/pulse，
 * 切回标签页、换页、或有人调用 requestPulseRefresh()（提交 / 取消 / 派发成功）时立刻重读。
 * 拉失败就保留上一份读数（不把数字清成零冒充「空闲」）。
 */
export function usePulse(initial: ExchangePulse, refreshKey?: string): ExchangePulse {
  const [pulse, setPulse] = useState(initial);
  const lastFetch = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async (force: boolean) => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const now = Date.now();
    if (!force && now - lastFetch.current < MIN_GAP_MS) return;
    lastFetch.current = now;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const response = await fetch(PULSE_ENDPOINT, { cache: "no-store", signal: controller.signal });
      if (!response.ok) return;
      const next = (await response.json()) as ExchangePulse;
      if (typeof next?.generating === "number") setPulse(next);
    } catch {
      /* 网络抖动或被新请求取代：保留上一份读数 */
    }
  }, []);

  useEffect(() => {
    lastFetch.current = Date.now();
    const timer = window.setInterval(() => void refresh(true), PULSE_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetch.current >= PULSE_INTERVAL_MS) void refresh(true);
    };
    const onRequest = () => void refresh(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(PULSE_REFRESH_EVENT, onRequest);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(PULSE_REFRESH_EVENT, onRequest);
      inFlight.current?.abort();
    };
  }, [refresh]);

  // 客户端换页时 layout 不重渲染：换页也读一次，壳层不再冻在首屏那一刻。
  const firstKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstKey.current) return;
    firstKey.current = refreshKey;
    const timer = window.setTimeout(() => void refresh(false), 0);
    return () => window.clearTimeout(timer);
  }, [refreshKey, refresh]);

  return pulse;
}
