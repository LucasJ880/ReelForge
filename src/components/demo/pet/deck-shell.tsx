"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
 *   - Framer Motion 入场动画，prefers-reduced-motion 时降级为瞬切
 *
 * 不改动任何既有区块组件：把它们按章节分组塞进 slides 即可。
 */
export function DeckShell({ slides, brand, cta }: DeckShellProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  // 已揭示的最大页码：保证翻过的页保持可见，回滚不会变空白。
  const [maxRevealed, setMaxRevealed] = useState(0);
  const reduceMotion = useReducedMotion();
  const total = slides.length;
  const showHint = active === 0;

  const scrollToIndex = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(total - 1, index));
      const el = slideRefs.current[clamped];
      if (!el) return;
      el.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    },
    [total, reduceMotion],
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
            setMaxRevealed((prev) => (idx > prev ? idx : prev));
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
    <div className="deck-root relative h-svh w-full overflow-hidden">
      {/* 顶部进度条 */}
      <div className="deck-progress" aria-hidden>
        <div
          className="deck-progress-bar"
          style={{ width: `${((active + 1) / total) * 100}%` }}
        />
      </div>

      {/* 固定的品牌 + CTA 头 */}
      <div className="deck-topbar">
        <div className="min-w-0">{brand}</div>
        <div className="flex items-center gap-3">
          <span className="deck-counter" aria-live="polite">
            {String(active + 1).padStart(2, "0")}
            <span className="text-muted-foreground/50"> / {String(total).padStart(2, "0")}</span>
          </span>
          {cta}
        </div>
      </div>

      {/* 右侧圆点导航 */}
      <DeckDots
        slides={slides}
        active={active}
        onSelect={scrollToIndex}
      />

      {/* 滚动容器 */}
      <div ref={scrollerRef} className="deck-scroller">
        {slides.map((slide, index) => (
          <section
            key={slide.id}
            id={`slide-${slide.id}`}
            data-index={index}
            ref={(el) => {
              slideRefs.current[index] = el;
            }}
            className="deck-slide"
            aria-label={slide.label}
          >
            <DeckSlideBody
              revealed={index <= maxRevealed}
              justReached={index === active}
              reduceMotion={Boolean(reduceMotion)}
            >
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
  revealed,
  justReached,
  reduceMotion,
}: {
  children: ReactNode;
  /// 该幻灯片是否应可见（当前页或已翻过的页）。可见性不依赖 whileInView，杜绝空白。
  revealed: boolean;
  /// 是否正好是当前激活页（用于播放上移入场动画）。
  justReached: boolean;
  reduceMotion: boolean;
}) {
  if (reduceMotion) {
    return (
      <div data-deck-inner className="deck-slide-inner">
        <div className="deck-slide-content">{children}</div>
      </div>
    );
  }
  return (
    <div data-deck-inner className="deck-slide-inner">
      <motion.div
        className="deck-slide-content"
        initial={false}
        animate={{
          opacity: revealed ? 1 : 0,
          y: revealed ? 0 : 28,
        }}
        transition={{
          duration: justReached ? 0.55 : 0.3,
          ease: [0.22, 0.61, 0.36, 1],
        }}
      >
        {children}
      </motion.div>
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
    <nav className="deck-dots" aria-label="幻灯片导航">
      <ol>
        {slides.map((slide, index) => (
          <li key={slide.id}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              className={`deck-dot ${index === active ? "is-active" : ""}`}
              aria-current={index === active ? "true" : undefined}
              aria-label={`${index + 1}. ${slide.label}`}
            >
              <span className="deck-dot-mark" aria-hidden />
              <span className="deck-dot-label">{slide.label}</span>
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
    <div className="deck-pager" aria-hidden={false}>
      <button
        type="button"
        onClick={onPrev}
        disabled={isFirst}
        className="deck-pager-btn"
        aria-label="上一页"
      >
        <ChevronUp size={18} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={isLast}
        className="deck-pager-btn"
        aria-label="下一页"
      >
        <ChevronDown size={18} />
      </button>
      <AnimatePresence>
        {showHint ? (
          <motion.span
            className="deck-hint"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.4 }}
          >
            滚动 / 方向键翻页
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
