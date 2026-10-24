import Link from "next/link";
import { LocalTime } from "@/components/exchange/local-time";
import { TickGlyph, batchTone, tickToneClass, type TickTone } from "@/components/exchange/status-tick";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { cn } from "@/lib/utils";

/** 成交带的一笔批次：来自本工作区真实批次（PlatformLayout 服务端查询），不放示例数据。 */
export type TapeEntry = {
  id: string;
  name: string;
  status: "EXPANDING" | "RUNNING" | "PAUSED" | "COMPLETED" | "PARTIAL_FAILED" | "FAILED" | "CANCELLED";
  done: number;
  total: number;
  failed: number;
  at: string;
};

/** 带上的一格：编号 · 名称 · 状态记号 · 读数 · 本地时间。 */
export type TapeItem = {
  id: string;
  href: string;
  code: string;
  name: string;
  tone: TickTone;
  state: string;
  figure?: string;
  failed?: number;
  at: string;
};

export function batchTapeItems(entries: TapeEntry[], locale: string): TapeItem[] {
  const states = getPlatformCopy(locale === "en-US" ? "en-US" : "zh-CN").shell.batchStates;
  return entries.map((entry) => ({
    id: entry.id,
    href: `/app/batches/${entry.id}`,
    code: `B·${entry.id.slice(-5).toUpperCase()}`,
    name: entry.name,
    tone: batchTone(entry.status),
    state: states[entry.status],
    figure: `${entry.done}/${entry.total}`,
    failed: entry.failed,
    at: entry.at,
  }));
}

/**
 * 实时成交带：无限滚动的一条行情（悬停暂停，减少动态时静止）。
 * 两条相同的轨道首尾相接；第二条对读屏与键盘隐藏。
 */
export function ExchangeTape({
  items,
  locale,
  label,
  trailing,
  className,
  itemClassName,
}: {
  items: TapeItem[];
  locale: string;
  label: string;
  trailing?: React.ReactNode;
  className?: string;
  itemClassName?: string;
}) {
  const track = (
    <>
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          prefetch={false}
          className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-data hover:text-foreground", itemClassName)}
        >
          <span className="text-tertiary">{item.code}</span>
          <span className="font-sans text-[1.09em] text-foreground">{item.name}</span>
          <span className={cn("inline-flex items-center gap-1", tickToneClass(item.tone))}>
            <TickGlyph tone={item.tone} />
            {item.state}
          </span>
          {item.figure ? (
            <span className="inline-flex items-center gap-1 tabular-nums text-foreground">
              {item.figure}
              {item.failed ? (
                <span className="inline-flex items-center gap-0.5 text-danger">
                  <TickGlyph tone="fault" />
                  {item.failed}
                </span>
              ) : null}
            </span>
          ) : null}
          <LocalTime iso={item.at} locale={locale} className="tabular-nums text-tertiary" />
        </Link>
      ))}
      {trailing ? <span className="flex shrink-0 items-center whitespace-nowrap font-mono text-data text-tertiary">{trailing}</span> : null}
    </>
  );
  return (
    <section
      aria-label={label}
      className={cn("x-tape items-center text-muted-foreground", className)}
      style={{ "--tape-duration": `${Math.max(items.length * 7, 28)}s` } as React.CSSProperties}
    >
      <div className="x-tape-track items-center">{track}</div>
      <div className="x-tape-track items-center" aria-hidden inert>
        {track}
      </div>
    </section>
  );
}
