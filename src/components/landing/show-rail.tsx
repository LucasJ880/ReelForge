"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

/**
 * 展厅一节：标题 + 一句话 + 右侧左右箭头 + 横向吸附轮播（学 Seedance 2.5 官网）。
 * 进入视口时整节淡入上移一次；卡里的视频只在可见时播放，滑出视口即暂停。
 */
export function ShowRail({
  id,
  title,
  body,
  prev,
  next,
  children,
}: {
  id: string;
  title: string;
  body: string;
  prev: string;
  next: string;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const rail = railRef.current;
    if (!section || !rail) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    /// 脚本接管后才把还没进视口的节藏起来；没有 JS 时整节始终可见
    const box = section.getBoundingClientRect();
    if (!still && box.top > window.innerHeight) section.dataset.shown = "false";
    const reveal = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          section.dataset.shown = "true";
          reveal.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    reveal.observe(section);
    const videos = Array.from(rail.querySelectorAll("video"));
    const playback = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting && !still) void video.play().catch(() => undefined);
          else video.pause();
        }
      },
      { threshold: 0.4 },
    );
    videos.forEach((video) => playback.observe(video));
    return () => {
      reveal.disconnect();
      playback.disconnect();
    };
  }, []);

  const scroll = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section ref={sectionRef} aria-labelledby={id} className="show-section show-reveal">
      <div className="show-section-head">
        <div className="min-w-0">
          <h2 id={id} className="show-section-title">
            {title}
          </h2>
          <p className="show-section-body">{body}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="show-arrow" aria-label={prev} onClick={() => scroll(-1)}>
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <button type="button" className="show-arrow" aria-label={next} onClick={() => scroll(1)}>
            <ArrowRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <ul ref={railRef} className="show-rail" aria-label={title}>
        {children}
      </ul>
    </section>
  );
}
