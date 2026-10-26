"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicCapabilities } from "@/lib/capabilities/registry";

export const CAPABILITIES_ENDPOINT = "/api/capabilities";
/** 能力状态每小时探测一次、生产调用实时回写；壳层 5 分钟读一次就够，页面不可见时不读。 */
export const CAPABILITIES_INTERVAL_MS = 5 * 60_000;

/**
 * 壳层的能力状态小岛：首屏用服务端值，之后页面可见时每 5 分钟读一次 GET /api/capabilities，
 * 切回标签页且已过期时立刻补读。读失败保留上一份（不把「暂停」清掉冒充正常）。
 */
export function useCapabilities(initial: PublicCapabilities | null): PublicCapabilities | null {
  const [capabilities, setCapabilities] = useState(initial);
  const lastFetch = useRef(0);

  useEffect(() => {
    lastFetch.current = Date.now();
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      lastFetch.current = Date.now();
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(CAPABILITIES_ENDPOINT, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const next = (await response.json()) as PublicCapabilities;
        if (Array.isArray(next?.items)) setCapabilities(next);
      } catch {
        /* 网络抖动或被新请求取代：保留上一份 */
      }
    };
    const timer = window.setInterval(() => void refresh(), CAPABILITIES_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetch.current >= CAPABILITIES_INTERVAL_MS) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      controller?.abort();
    };
  }, []);

  return capabilities;
}
