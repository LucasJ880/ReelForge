import type { Locale } from "@/i18n/config";
import {
  stateTone,
  stateWord,
  type TickTone,
  type VocabEntity,
  type VocabState,
} from "@/lib/exchange/state-vocab";
import { cn } from "@/lib/utils";

export type { TickTone } from "@/lib/exchange/state-vocab";

const TONE_CLASS: Record<TickTone, string> = {
  live: "text-accent",
  filled: "text-success",
  partial: "text-gold",
  fault: "text-danger",
  idle: "text-muted-foreground",
  void: "text-tertiary",
  queued: "text-muted-foreground",
};

export function tickToneClass(tone: TickTone): string {
  return TONE_CLASS[tone];
}

/*
 * 行情记号：一套 12 格自绘字形，替代 ▲●◐▼‖× 字符（字体回退会让它们大小粗细各异）。
 * 上涨三角=生成中，实心圆=已成片 / 已完成，半圆=部分失败，下跌三角=失败，双竖=暂停，
 * 叉=取消，空心圈=排队中（还没开始，不是暂停）。尺寸跟随字号（1em 方框内留同样的光学边距）。
 */
export function TickGlyph({ tone, className }: { tone: TickTone; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={cn("size-[0.9em] shrink-0", className)} fill="currentColor">
      {tone === "live" ? <path d="M6 1.75 10.75 10H1.25Z" /> : null}
      {tone === "fault" ? <path d="M6 10.25 1.25 2h9.5Z" /> : null}
      {tone === "filled" ? <circle cx="6" cy="6" r="4.25" /> : null}
      {tone === "partial" ? (
        <>
          <circle cx="6" cy="6" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path d="M6 1.75a4.25 4.25 0 0 1 0 8.5Z" />
        </>
      ) : null}
      {tone === "idle" ? (
        <>
          <rect x="3" y="2" width="2" height="8" rx="0.5" />
          <rect x="7" y="2" width="2" height="8" rx="0.5" />
        </>
      ) : null}
      {tone === "void" ? (
        <path d="m2.75 2.75 6.5 6.5m0-6.5-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : null}
      {tone === "queued" ? <circle cx="6" cy="6" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" /> : null}
    </svg>
  );
}

/**
 * 行情状态：一个记号 + 一个状态词，都从状态词典（state-vocab）取，颜色与形状成对出现。
 * 只接收「实体 × 状态」，不接收自由文本——不是状态的标签（样例、草案、攒样本）用 MonoTag。
 */
export function StatusTick<E extends VocabEntity>({
  entity,
  state,
  locale,
  className,
}: {
  entity: E;
  state: VocabState<E>;
  locale: Locale;
  className?: string;
}) {
  const tone = stateTone(entity, state);
  return (
    <span
      data-state={state}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-data uppercase tracking-wide", TONE_CLASS[tone], className)}
    >
      <TickGlyph tone={tone} />
      {stateWord(entity, state, locale)}
    </span>
  );
}
