"use client";

import { cn } from "@/lib/utils";

/**
 * 选中态控件（1025 · B2.2）：选中 = aria-pressed + 信号青细线 + 舰桥底。
 *
 * 实心信号青只给「一页一枚」的主行动，从不表达「选中」——
 * 之前模板库分类芯片用 variant="default" 表示选中，整页唯一的实心青变成了一个筛选芯片。
 */
const CHIP_BASE =
  "inline-flex h-(--control-height) shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-(--radius-md) border px-3 text-meta font-medium tabular-nums transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]";
const CHIP_ON = "border-(--accent-line) bg-active text-accent";
const CHIP_OFF = "border-border text-muted-foreground hover:border-border-strong hover:text-foreground";

export function chipClassName(pressed: boolean, className?: string): string {
  return cn(CHIP_BASE, pressed ? CHIP_ON : CHIP_OFF, className);
}

/** 可多选 / 可单独开关的筛选芯片。 */
export function FilterChip({
  pressed,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-pressed"> & { pressed: boolean }) {
  return (
    <button type="button" aria-pressed={pressed} data-slot="filter-chip" className={chipClassName(pressed, className)} {...props}>
      {children}
    </button>
  );
}

/** 单选分段：一组里只有一个被按下；重复点当前档不触发 onChange。 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: React.ReactNode }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} data-slot="segmented" className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <FilterChip
            key={option.value}
            pressed={active}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
          >
            {option.label}
          </FilterChip>
        );
      })}
    </div>
  );
}
