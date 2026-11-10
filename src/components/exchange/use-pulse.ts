"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PULSE_ENDPOINT,
  PULSE_INTERVAL_MS,
  PULSE_REFRESH_EVENT,
  sessionExpiredLoginUrl,
  type ExchangePulse,
} from "@/lib/exchange/pulse";

/** 连续的主动刷新（导航、提交）至少隔这么久，免得一次点击打两次接口。 */
const MIN_GAP_MS = 4_000;
/** 最后一次见到在途视频之后，标签页在后台还继续读多久（盖住合成成片的一两分钟，留足余量）。 */
const BACKGROUND_WATCH_GRACE_MS = 10 * 60_000;

/**
 * 壳层脉搏小岛：首屏用服务端值；页面可见时（或有视频在途时即使在后台）每 30 秒拉一次 /api/exchange/pulse，
 * 切回标签页、换页、或有人调用 requestPulseRefresh()（提交 / 取消 / 派发成功）时立刻重读。
 * 拉失败就保留上一份读数（不把数字清成零冒充「空闲」）。
 */
export function usePulse(initial: ExchangePulse, refreshKey?: string): ExchangePulse {
  const [pulse, setPulse] = useState(initial);
  const lastFetch = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const leaving = useRef(false);

  /// 有视频在生成 / 排队时，标签页在后台也继续读（浏览器会把后台定时器压到约一分钟一次）：
  /// 商家等片时多半切去干别的，成片做好要能把标签页标题换掉；没有在途任务就照旧不读。
  /// 画面生成完到成片合成好还有一两分钟、这段不算「生成中」，所以最后一次见到在途任务后再多看一会儿。
  const watchUntil = useRef(0);
  const startedInFlight = initial.generating > 0 || initial.queued > 0;

  const refresh = useCallback(async (force: boolean) => {
    const now = Date.now();
    if (typeof document !== "undefined" && document.visibilityState !== "visible" && now > watchUntil.current) return;
    if (!force && now - lastFetch.current < MIN_GAP_MS) return;
    lastFetch.current = now;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const response = await fetch(PULSE_ENDPOINT, { cache: "no-store", signal: controller.signal });
      if (response.status === 401) {
        /// 登录失效（每次发版、闲置 12 小时、登录满 7 天都会失效）。开着的页面之前不知道：点哪都卡在加载中，
        /// 要手动刷新才被送去登录（2026-11-10 线上反馈）。脉搏每 30 秒、切回标签页、换页都会读一次，
        /// 一旦回 401 就整页跳到登录页，登录完回到原处。只跳一次。
        if (!leaving.current) {
          leaving.current = true;
          window.location.assign(sessionExpiredLoginUrl(window.location.pathname, window.location.search));
        }
        return;
      }
      if (!response.ok) return;
      const next = (await response.json()) as ExchangePulse;
      if (typeof next?.generating === "number") {
        if (next.generating > 0 || next.queued > 0) watchUntil.current = Date.now() + BACKGROUND_WATCH_GRACE_MS;
        setPulse(next);
      }
    } catch {
      /* 网络抖动或被新请求取代：保留上一份读数 */
    }
  }, []);

  useEffect(() => {
    lastFetch.current = Date.now();
    if (startedInFlight) watchUntil.current = Date.now() + BACKGROUND_WATCH_GRACE_MS;
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
    /// 首屏那份脉搏里有没有在途任务只在挂载时用一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
