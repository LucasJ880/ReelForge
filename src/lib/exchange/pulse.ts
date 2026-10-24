import type { BatchJobStatusKey } from "@/lib/exchange/state-vocab";

/**
 * 交易台脉搏（1025 · B1.1）：壳层的市场状态、导轨徽标、生产带与月度额度只看这一份。
 * 服务端由 exchange-readings 的 loadPulse() 产出；壳层首屏用服务端值，之后在页面可见时
 * 每 30 秒拉一次 GET /api/exchange/pulse，提交 / 取消 / 派发成功后主动刷新。
 *
 * 纯类型 + 浏览器事件，不引服务端模块：'use client' 组件可以安全 import。
 */

/** 生产带的一笔批次：来自本工作区真实批次，不放示例数据。 */
export type TapeEntry = {
  id: string;
  name: string;
  status: BatchJobStatusKey;
  done: number;
  total: number;
  failed: number;
  at: string;
};

/** 计量档：trial（D5 试用）/ starter（入门版）/ studio（专业版）。 */
export type PulsePlan = "trial" | "starter" | "studio";

export type ExchangePulse = {
  /** 真在生成的视频条数：供应商侧有活跃任务的视频（不含排队、暂停与图文帖）。 */
  generating: number;
  /** 已下单、还没开始生成的视频条数（不含暂停）。 */
  queued: number;
  /** 进行中批次：拆单中 / 生成中，不含已暂停。 */
  activeBatches: number;
  /** 已暂停的批次。 */
  pausedBatches: number;
  /** 排好但还没出图的图文帖（金色待办）。 */
  awaitingImages: number;
  /** 需要处理：近 7 天、未重试成功、在「看过了」之后的失败视频。 */
  needsAttention: number;
  /** 未归档的新询盘（金色徽标）。 */
  newLeads: number;
  /** 本月（UTC 自然月）视频派发用量与生效上限。 */
  quota: { used: number; limit: number; plan: PulsePlan };
  tape: TapeEntry[];
  /** 服务端读数时刻（ISO）。 */
  at: string;
};

export const PULSE_ENDPOINT = "/api/exchange/pulse";
export const PULSE_INTERVAL_MS = 30_000;
export const PULSE_REFRESH_EVENT = "aivora:pulse-refresh";

/**
 * 让壳层马上重读脉搏：批次提交 / 取消、单条派发成功后调一下。
 * 壳层不在（比如大屏）时这是空操作。
 */
export function requestPulseRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PULSE_REFRESH_EVENT));
}
