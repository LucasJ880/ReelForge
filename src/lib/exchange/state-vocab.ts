import type { Locale } from "@/i18n/config";

/**
 * 状态词典：「实体 × 状态 → 一个词 + 一个记号」的唯一一张表（1025 · B1.3）。
 *
 * 之前五份词表各写各的：同一批次成交带写「已成交」、批量表写「已完成」；
 * 同一任务批次详情写「排队中」、成品库写「准备中」；暂停的「‖」又被借去当「样片待补」。
 * 现在一律从这里取词与记号：
 *   排队中 / 生成中 / 已暂停 / 已成片（条）· 已完成（批）/ 部分失败 / 失败 / 已取消。
 * 「成交」只留给询盘（lead.WON），视频侧一律「已成片」。
 *
 * 纯数据 + 纯函数，不引任何服务端模块：'use client' 组件与服务端页面都能安全 import。
 */

/** 记号的形：上涨三角 / 实心圆 / 半圆 / 下跌三角 / 双竖 / 叉 / 空心圈。 */
export type TickTone = "live" | "filled" | "partial" | "fault" | "idle" | "void" | "queued";

type VocabEntry = { readonly tone: TickTone; readonly "zh-CN": string; readonly "en-US": string };

function entry(tone: TickTone, zh: string, en: string): VocabEntry {
  return { tone, "zh-CN": zh, "en-US": en };
}

/** 生产侧的 7 个词位（视频条与批次共用同一套词，只有「完成」按实体分词）。 */
const QUEUED = entry("queued", "排队中", "Queued");
const GENERATING = entry("live", "生成中", "Generating");
const PAUSED = entry("idle", "已暂停", "Paused");
const FAILED = entry("fault", "失败", "Failed");
const CANCELLED = entry("void", "已取消", "Cancelled");

export const STATE_VOCAB = {
  /** 一条视频：单条订单、批量里的一条任务、成品库的一行。 */
  item: {
    queued: QUEUED,
    generating: GENERATING,
    paused: PAUSED,
    done: entry("filled", "已成片", "Ready"),
    failed: FAILED,
    cancelled: CANCELLED,
  },
  /** 一个批次。 */
  batch: {
    queued: QUEUED,
    generating: GENERATING,
    paused: PAUSED,
    done: entry("filled", "已完成", "Completed"),
    partial: entry("partial", "部分失败", "Partly failed"),
    failed: FAILED,
    cancelled: CANCELLED,
  },
  /** 故事板的一帧画面。held = 单帧重生成被计费核对挡住（不是失败，也不在生成）。 */
  frame: {
    queued: QUEUED,
    generating: GENERATING,
    held: entry("idle", "等待计费核对", "Pending billing check"),
    done: entry("filled", "已出图", "Drawn"),
    failed: FAILED,
  },
  /** 图文帖的一屏配图（C2 · Shuyu 异步出图）。cancelled = 停止出图时还没提交，不产生费用。 */
  slide: {
    queued: QUEUED,
    generating: GENERATING,
    done: entry("filled", "已出图", "Drawn"),
    failed: FAILED,
    cancelled: CANCELLED,
  },
  /** 一轮产品图。 */
  image: {
    queued: QUEUED,
    generating: GENERATING,
    done: entry("filled", "已完成", "Done"),
    failed: FAILED,
    cancelled: CANCELLED,
  },
  /** 询盘：「成交」只在这里出现。 */
  lead: {
    NEW: entry("live", "新询盘", "New"),
    CONTACTED: entry("partial", "已联系", "Contacted"),
    BOOKED: entry("partial", "已预约", "Booked"),
    WON: entry("filled", "已成交", "Won"),
    LOST: entry("void", "未成交", "Lost"),
  },
  /** 商家询盘页的开通状态。 */
  leadPage: {
    on: entry("live", "已开通", "Live"),
    off: entry("void", "未开通", "Off"),
  },
  /** 公开表单提交之后。 */
  submission: {
    received: entry("filled", "已收到", "Received"),
  },
  /** 上手向导的一步（/app/welcome）：做没做完从真实数据推出来；进行中 = 等你接着做。 */
  setupStep: {
    todo: entry("queued", "待完成", "To do"),
    started: entry("partial", "进行中", "In progress"),
    done: entry("filled", "已完成", "Done"),
  },
  /**
   * 一项 AI / 供应商能力（C4 能力注册表，src/lib/capabilities/registry.ts）。
   * 暂停是供应商侧故障（额度、权限、宕机），用失败记号；未开通是配置，用叉。
   */
  capability: {
    available: entry("filled", "正常", "Operational"),
    degraded: entry("partial", "不稳定", "Unstable"),
    unavailable: entry("fault", "暂停", "Paused"),
    not_configured: entry("void", "未开通", "Not set up"),
  },
} as const satisfies Record<string, Record<string, VocabEntry>>;

export type VocabEntity = keyof typeof STATE_VOCAB;
export type VocabState<E extends VocabEntity> = keyof (typeof STATE_VOCAB)[E] & string;
export type ItemState = VocabState<"item">;
export type BatchState = VocabState<"batch">;

function lookup<E extends VocabEntity>(entity: E, state: VocabState<E>): VocabEntry {
  return (STATE_VOCAB[entity] as Record<string, VocabEntry>)[state];
}

export function stateWord<E extends VocabEntity>(entity: E, state: VocabState<E>, locale: Locale): string {
  return lookup(entity, state)[locale];
}

export function stateTone<E extends VocabEntity>(entity: E, state: VocabState<E>): TickTone {
  return lookup(entity, state).tone;
}

/** 一个实体的全部词（某种语言），给需要「状态 → 词」字典的旧调用方用。 */
export function stateWords<E extends VocabEntity>(entity: E, locale: Locale): Record<VocabState<E>, string> {
  return Object.fromEntries(
    Object.entries(STATE_VOCAB[entity] as Record<string, VocabEntry>).map(([state, value]) => [state, value[locale]]),
  ) as Record<VocabState<E>, string>;
}

/* ── 数据库枚举 → 词位 ─────────────────────────────────────────────── */

export type BatchJobStatusKey = "EXPANDING" | "RUNNING" | "PAUSED" | "COMPLETED" | "PARTIAL_FAILED" | "FAILED" | "CANCELLED";
export type VideoJobStatusKey = "QUEUED" | "PAUSED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

/** 批次：EXPANDING 是「拆单、还没开始出片」，按排队算——不挂光束，也不算生成中。 */
const BATCH_STATE: Record<BatchJobStatusKey, BatchState> = {
  EXPANDING: "queued",
  RUNNING: "generating",
  PAUSED: "paused",
  COMPLETED: "done",
  PARTIAL_FAILED: "partial",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export function batchState(status: BatchJobStatusKey): BatchState {
  return BATCH_STATE[status];
}

const JOB_STATE: Record<VideoJobStatusKey, ItemState> = {
  QUEUED: "queued",
  PAUSED: "paused",
  RUNNING: "generating",
  SUCCEEDED: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export function videoJobState(status: VideoJobStatusKey): ItemState {
  return JOB_STATE[status];
}

export type LibraryStatusKey = "planning" | "generating" | "assembling" | "ready" | "failed" | "paused" | "cancelled";

/** 成品库行：准备中（还没提交给供应商）按排队算，合成中仍是生成中。 */
const LIBRARY_STATE: Record<LibraryStatusKey, ItemState> = {
  planning: "queued",
  generating: "generating",
  assembling: "generating",
  ready: "done",
  failed: "failed",
  paused: "paused",
  cancelled: "cancelled",
};

export function libraryRowState(status: LibraryStatusKey): ItemState {
  return LIBRARY_STATE[status];
}

export type ProductImageStatusKey = "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

const IMAGE_STATE: Record<ProductImageStatusKey, VocabState<"image">> = {
  QUEUED: "queued",
  PROCESSING: "generating",
  SUCCEEDED: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export function productImageState(status: ProductImageStatusKey): VocabState<"image"> {
  return IMAGE_STATE[status];
}

/** 批次词按 DB 枚举取（批量表、成交带、大屏共用）。 */
export function batchStatusWords(locale: Locale): Record<BatchJobStatusKey, string> {
  return Object.fromEntries(
    (Object.keys(BATCH_STATE) as BatchJobStatusKey[]).map((status) => [status, stateWord("batch", BATCH_STATE[status], locale)]),
  ) as Record<BatchJobStatusKey, string>;
}

/** 任务词按 DB 枚举取（批次详情的任务行）。 */
export function videoJobStatusWords(locale: Locale): Record<VideoJobStatusKey, string> {
  return Object.fromEntries(
    (Object.keys(JOB_STATE) as VideoJobStatusKey[]).map((status) => [status, stateWord("item", JOB_STATE[status], locale)]),
  ) as Record<VideoJobStatusKey, string>;
}

/** 成品库行词。 */
export function libraryStatusWords(locale: Locale): Record<LibraryStatusKey, string> {
  return Object.fromEntries(
    (Object.keys(LIBRARY_STATE) as LibraryStatusKey[]).map((status) => [status, stateWord("item", LIBRARY_STATE[status], locale)]),
  ) as Record<LibraryStatusKey, string>;
}
