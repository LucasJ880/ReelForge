"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * 单张幻灯片的定义。`node` 为已有的 pet demo 区块组件（一个或多个）。
 */
export interface DeckSlideDef {
  id: string;
  /// 右侧圆点导航上显示的短标签
  label: string;
  node: ReactNode;
}

interface DeckShellProps {
  slides: DeckSlideDef[];
  /// 固定在左上角的品牌区（Logo + 名称）
  brand?: ReactNode;
  /// 固定在右上角的主 CTA（如「申请体验」）
  cta?: ReactNode;
}

/**
 * Aivora 投资人 Demo 的「网页幻灯片」外壳（/showcase）。
 *
 * 纯原生方案，全自托管、国内可访问：
 *   - CSS scroll-snap（整屏吸附）让每次滚动落在一张幻灯片上
 *   - IntersectionObserver 追踪当前页 → 驱动右侧圆点导航 / 顶部进度条 / 页码
 *   - 键盘导航（↑↓ / PgUp PgDn / Space / Home / End），并在超高幻灯片内
 *     先消费内部滚动、到边界再翻页
 *   - 不使用装饰动画，滚动行为自动遵循 prefers-reduced-motion
 *
 * 不改动任何既有区块组件：把它们按章节分组塞进 slides 即可。
 */
export function DeckShell({ slides, brand, cta }: DeckShellProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const total = slides.length;
  const showHint = active === 0;

  const scrollToIndex = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(total - 1, index));
      const el = slideRefs.current[clamped];
      if (!el) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      el.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    },
    [total],
  );

  // 追踪当前激活的幻灯片
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.index ?? "0",
            );
            setActive(idx);
          }
        }
      },
      { root: scroller, threshold: [0.55] },
    );
    for (const el of slideRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [total]);

  // 键盘导航：超高幻灯片内先走内部滚动，到边界再翻页
  useEffect(() => {
    const canScrollWithin = (dir: "up" | "down") => {
      const inner = slideRefs.current[active]?.querySelector<HTMLElement>(
        "[data-deck-inner]",
      );
      if (!inner) return false;
      const slack = 8;
      if (dir === "down") {
        return inner.scrollTop + inner.clientHeight < inner.scrollHeight - slack;
      }
      return inner.scrollTop > slack;
    };

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      switch (event.key) {
        case "ArrowDown":
        case "PageDown":
        case " ":
          if (canScrollWithin("down")) return;
          event.preventDefault();
          scrollToIndex(active + 1);
          break;
        case "ArrowUp":
        case "PageUp":
          if (canScrollWithin("up")) return;
          event.preventDefault();
          scrollToIndex(active - 1);
          break;
        case "Home":
          event.preventDefault();
          scrollToIndex(0);
          break;
        case "End":
          event.preventDefault();
          scrollToIndex(total - 1);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, total, scrollToIndex]);

  return (
    <div className="relative h-svh w-full overflow-hidden bg-background">
      {/* 顶部进度条 */}
      <div className="absolute inset-x-0 top-0 z-40 h-0.5 bg-border" aria-hidden>
        <div
          className="h-full bg-primary"
          style={{ width: `${((active + 1) / total) * 100}%` }}
        />
      </div>

      {/* 固定的品牌 + CTA 头 */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6 lg:px-10">
        <div className="min-w-0">{brand}</div>
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3">
          <span className="hidden text-meta tabular-nums text-muted-foreground min-[390px]:inline" aria-live="polite">
            {String(active + 1).padStart(2, "0")}
            <span className="text-muted-foreground/50"> / {String(total).padStart(2, "0")}</span>
          </span>
          {cta}
        </div>
      </header>

      {/* 右侧圆点导航 */}
      <DeckDots
        slides={slides}
        active={active}
        onSelect={scrollToIndex}
      />

      {/* 滚动容器 */}
      <div
        ref={scrollerRef}
        className="h-full snap-y snap-mandatory overflow-x-hidden overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, index) => (
          <section
            key={slide.id}
            id={`slide-${slide.id}`}
            data-index={index}
            ref={(el) => {
              slideRefs.current[index] = el;
            }}
            className="relative h-svh snap-start snap-always"
            aria-label={slide.label}
          >
            <DeckSlideBody>
              {slide.node}
            </DeckSlideBody>
          </section>
        ))}
      </div>

      {/* 翻页引导提示 + 上下翻页按钮 */}
      <DeckPager
        active={active}
        total={total}
        showHint={showHint}
        onPrev={() => scrollToIndex(active - 1)}
        onNext={() => scrollToIndex(active + 1)}
      />
    </div>
  );
}

function DeckSlideBody({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      data-deck-inner
      className="flex h-full flex-col justify-center overflow-y-auto pb-16 pt-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-full flex-col gap-8 [&>section]:py-0 sm:gap-12">
        {children}
      </div>
    </div>
  );
}

function DeckDots({
  slides,
  active,
  onSelect,
}: {
  slides: DeckSlideDef[];
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 lg:block" aria-label="幻灯片导航">
      <ol className="flex flex-col items-end gap-1">
        {slides.map((slide, index) => (
          <li key={slide.id}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              className="group flex min-h-8 items-center gap-2 rounded-md px-2 text-meta text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-current={index === active ? "true" : undefined}
              aria-label={`${index + 1}. ${slide.label}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  index === active ? "bg-primary" : "bg-border"
                }`}
                aria-hidden
              />
              <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-40 group-hover:opacity-100">
                {slide.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function DeckPager({
  active,
  total,
  showHint,
  onPrev,
  onNext,
}: {
  active: number;
  total: number;
  showHint: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const isFirst = active === 0;
  const isLast = active === total - 1;
  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 sm:bottom-4 sm:right-4" aria-hidden={false}>
      <button
        type="button"
        onClick={onPrev}
        disabled={isFirst}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="上一页"
      >
        <ChevronUp size={18} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={isLast}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="下一页"
      >
        <ChevronDown size={18} />
      </button>
      {showHint ? (
        <span className="hidden text-meta text-muted-foreground sm:inline">
          滚动 / 方向键翻页
        </span>
      ) : null}
    </div>
  );
}
