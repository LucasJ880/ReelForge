import { cn } from "@/lib/utils";

export type TickTone = "live" | "filled" | "partial" | "fault" | "idle" | "void";

const TONE_CLASS: Record<TickTone, string> = {
  live: "text-accent",
  filled: "text-success",
  partial: "text-gold",
  fault: "text-danger",
  idle: "text-muted-foreground",
  void: "text-tertiary",
};

const BATCH_TONE: Record<string, TickTone> = {
  EXPANDING: "live",
  RUNNING: "live",
  PAUSED: "idle",
  COMPLETED: "filled",
  PARTIAL_FAILED: "partial",
  FAILED: "fault",
  CANCELLED: "void",
};

export function batchTone(status: string): TickTone {
  return BATCH_TONE[status] ?? "idle";
}

export function tickToneClass(tone: TickTone): string {
  return TONE_CLASS[tone];
}

/*
 * 行情记号：一套 12 格自绘字形，替代 ▲●◐▼‖× 字符（字体回退会让它们大小粗细各异）。
 * 上涨三角=生成中，实心圆=已成交，半圆=部分成交，下跌三角=失败，双竖=暂停，叉=取消。
 * 尺寸跟随字号（1em 方框内留同样的光学边距）。
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
    </svg>
  );
}

/** 行情状态：一个方向记号 + 状态词，颜色与形状成对出现（不只靠颜色）。 */
export function StatusTick({
  tone,
  label,
  className,
}: {
  tone: TickTone;
  label: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-data uppercase tracking-wide", TONE_CLASS[tone], className)}>
      <TickGlyph tone={tone} />
      {label}
    </span>
  );
}
