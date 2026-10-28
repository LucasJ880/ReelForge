"use client";

import { useEffect, useRef, useState } from "react";

export type HeroReelScene = { video: string; poster: string; label: string };

const SCENE_MS = 7000;

/**
 * 首页第一幕的全屏视频轮播（学 Seedance 2.5 官网）：静音、循环、交叉淡入，每 7 秒换一镜。
 * 只有当前一镜在播；标签页隐藏时暂停；prefers-reduced-motion 下不自动播放、不轮换，只留首镜海报。
 */
export function HeroReel({ scenes, sceneLabel }: { scenes: readonly HeroReelScene[]; sceneLabel: string }) {
  const [active, setActive] = useState(0);
  const [still, setStill] = useState(false);
  const refs = useRef<Array<HTMLVideoElement | null>>([]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (still || scenes.length < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setActive((current) => (current + 1) % scenes.length);
    }, SCENE_MS);
    return () => window.clearInterval(timer);
  }, [still, scenes.length]);

  useEffect(() => {
    refs.current.forEach((video, index) => {
      if (!video) return;
      if (index === active && !still) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
  }, [active, still]);

  return (
    <>
      {scenes.map((scene, index) => (
        <video
          key={scene.video}
          ref={(node) => {
            refs.current[index] = node;
          }}
          className="show-hero-video"
          data-active={index === active}
          src={scene.video}
          poster={scene.poster}
          muted
          loop
          playsInline
          preload={index === 0 ? "auto" : "metadata"}
          aria-hidden={index !== active}
          aria-label={scene.label}
        />
      ))}
      <div className="show-hero-scrim" aria-hidden />
      {scenes.length > 1 ? (
        <div className="show-scene" role="group" aria-label={sceneLabel}>
          {scenes.map((scene, index) => (
            <button
              key={scene.video}
              type="button"
              className="show-scene-dot"
              aria-current={index === active}
              aria-label={scene.label}
              onClick={() => setActive(index)}
            />
          ))}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {scenes[active]?.label}
      </span>
    </>
  );
}
