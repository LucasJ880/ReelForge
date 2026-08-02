"use client";

import { useMemo, useState, useTransition } from "react";
import styles from "./plan-timeline.module.css";

/**
 * O1 · 一周内容时间线（PRD §3 + §11）。
 *
 * 注意：这是 client 组件，**不得 import 任何服务端 service**。
 * 取了服务端模块的值会把 OpenAI / Prisma 打进浏览器 bundle，整页 500。
 * 有 client-bundle-safety 回归测试守着，别绕过它。
 * 所有数据都由 server component 以纯 DTO 传进来。
 */

export type TimelinePost = {
  id: string;
  key: string;
  dayOffset: number;
  format: "TEXT" | "SINGLE_IMAGE" | "CAROUSEL" | "VIDEO";
  status: "DRAFT" | "READY" | "DISCARDED";
  copyHook: string;
  copyBody: string;
  copyCta: string | null;
  hashtags: string[];
  rationale: string;
  recipeId: string | null;
  hookType: string | null;
  renderedImageUrls: string[];
  slideOverlays: (string | null)[];
  renderError: string | null;
};

export type TimelinePlan = {
  id: string;
  theme: string;
  targetAudience: string;
  corePainPoint: string;
  generatedBy: string;
  /// 这一周为什么这么排：自己的战绩 / 借同行结构 / 还没有依据。
  /// 借来的结构必须说明是借来的，不能让商家以为是他自己的数据结论。
  planBasis: string | null;
  posts: TimelinePost[];
};

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const FORMAT_LABEL: Record<TimelinePost["format"], string> = {
  TEXT: "文案",
  SINGLE_IMAGE: "单图",
  CAROUSEL: "轮播",
  VIDEO: "视频",
};

/**
 * 场记板镜号：把「创意配方」这个抽象概念变成可指认的实体。
 * `post:POV:single_image` → `POV·单图`
 */
function shotSlug(post: TimelinePost): string {
  const hook = post.hookType ?? "—";
  return `${hook}·${FORMAT_LABEL[post.format]}`;
}

export function PlanTimeline({
  plan,
  todayOffset,
}: {
  plan: TimelinePlan | null;
  /// 今天落在这一周的第几天。播放头画在这里。
  todayOffset: number;
}) {
  const [sentence, setSentence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    plan?.posts[0]?.key ?? null,
  );
  const [pending, startTransition] = useTransition();
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [posts, setPosts] = useState<TimelinePost[]>(plan?.posts ?? []);

  const byDay = useMemo(() => {
    const lanes: TimelinePost[][] = Array.from({ length: 7 }, () => []);
    for (const post of posts) {
      lanes[Math.min(6, Math.max(0, post.dayOffset))].push(post);
    }
    return lanes;
  }, [posts]);

  const selected = posts.find((post) => post.key === selectedKey) ?? null;
  const emptyDays = byDay.filter((lane) => lane.length === 0).length;

  async function createPlan() {
    setError(null);
    const input = sentence.trim();
    if (!input) return;
    const res = await fetch("/api/content-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: /^https?:\/\//i.test(input) ? "product_url" : "sentence",
        input,
        /// 幂等键按输入内容取，重复提交同一句话不会重复生成。
        idempotencyKey: `plan-${btoa(unescape(encodeURIComponent(input))).slice(0, 60)}`,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? "生成失败，请重试");
      return;
    }
    /// 服务端重新渲染整页，拿到落库后的真实数据，而不是在前端拼一份。
    window.location.reload();
  }

  async function renderPost(post: TimelinePost) {
    setError(null);
    setBusyPostId(post.id);
    try {
      const res = await fetch(
        `/api/content-plans/${plan?.id}/posts/${post.id}/render`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? "出图失败");
        return;
      }
      setPosts((current) =>
        current.map((item) =>
          item.id === post.id
            ? {
                ...item,
                renderedImageUrls: body.urls ?? [],
                status: "READY",
                renderError: null,
              }
            : item,
        ),
      );
    } finally {
      setBusyPostId(null);
    }
  }

  /**
   * 取消这一轮。铁律：每轮任务都要能取消，且取消**保留已出的素材**。
   * 失败时只给「重试」是不够的。
   */
  async function discardPost(post: TimelinePost) {
    setBusyPostId(post.id);
    try {
      await fetch(`/api/content-plans/${plan?.id}/posts/${post.id}/render`, {
        method: "DELETE",
      });
      setPosts((current) =>
        current.map((item) =>
          item.id === post.id ? { ...item, status: "DISCARDED" } : item,
        ),
      );
    } finally {
      setBusyPostId(null);
    }
  }

  return (
    <div className={styles.root} data-testid="cutting-room">
      <div className={styles.perf} aria-hidden="true" />

      <header className={styles.head}>
        <h1 className={styles.h1}>{plan?.theme ?? "一句话，排完一周"}</h1>
        <p className={styles.sub}>
          {plan
            ? `${plan.targetAudience} · ${plan.corePainPoint}`
            : "说清楚你家做什么生意、想让人来干什么，剩下的交给我们。没有独立站也没关系。"}
        </p>

        <div className={styles.intake}>
          <input
            value={sentence}
            onChange={(event) => setSentence(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") startTransition(createPlan);
            }}
            placeholder="我家做定制百叶窗，想让人来约免费上门量尺"
            aria-label="用一句话描述你的生意，或粘贴商品链接"
          />
          <button
            type="button"
            disabled={pending || !sentence.trim()}
            onClick={() => startTransition(createPlan)}
          >
            {pending ? "排期中" : "排一周"}
          </button>
        </div>
        {plan?.planBasis ? (
          <p className={styles.basis}>{plan.planBasis}</p>
        ) : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </header>

      <section className={styles.track} aria-label="本周内容时间线">
        <div className={styles.trackInner}>
          {/* 播放头：今天 */}
          <div
            className={styles.playhead}
            style={{ left: `${((todayOffset + 0.5) / 7) * 100}%` }}
            aria-hidden="true"
          />
          <div className={styles.ruler}>
            {WEEKDAYS.map((day, index) => (
              <div
                key={day}
                className={`${styles.tick} ${index === todayOffset ? styles.tickToday : ""}`}
              >
                <span>{day}</span>
                <span>{index === todayOffset ? "今天" : `D${index}`}</span>
              </div>
            ))}
          </div>
          <div className={styles.lanes}>
            {byDay.map((lane, index) => (
              <div
                key={index}
                className={`${styles.lane} ${lane.length === 0 ? styles.laneEmpty : ""}`}
              >
                {lane.length === 0 ? (
                  /* 空档画成真的缺口，不是留白 */
                  <div className={styles.hole}>空档</div>
                ) : (
                  lane.map((post) => (
                    <button
                      type="button"
                      key={post.key}
                      onClick={() => setSelectedKey(post.key)}
                      className={[
                        styles.clip,
                        post.key === selectedKey ? styles.clipSelected : "",
                        post.status === "READY" ? styles.clipReady : "",
                        post.status === "DISCARDED" ? styles.clipDiscarded : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={post.key === selectedKey}
                    >
                      <span className={styles.shotSlug}>{shotSlug(post)}</span>
                      <span className={styles.clipHook}>{post.copyHook}</span>
                    </button>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {selected ? (
        <section className={styles.detail} aria-label="内容详情">
          <div>
            <p className={styles.label}>
              {shotSlug(selected)} · {selected.recipeId ?? "无配方"}
            </p>
            <h2 className={styles.hook}>{selected.copyHook}</h2>
            <p className={styles.body}>{selected.copyBody}</p>
            {selected.copyCta ? (
              <>
                <p className={styles.label}>行动号召</p>
                <p className={styles.body}>{selected.copyCta}</p>
              </>
            ) : null}
            <p className={styles.label}>话题标签</p>
            <ul className={styles.tags}>
              {selected.hashtags.map((tag) => (
                <li key={tag} className={styles.tag}>
                  #{tag}
                </li>
              ))}
            </ul>
            <p className={styles.label} style={{ marginTop: 14 }}>
              为什么发这条
            </p>
            <p className={styles.body}>{selected.rationale}</p>
            {selected.renderError ? (
              <p className={styles.error}>{selected.renderError}</p>
            ) : null}

            <div className={styles.actions}>
              {selected.format === "SINGLE_IMAGE" ||
              selected.format === "CAROUSEL" ? (
                <button
                  type="button"
                  className={
                    selected.renderedImageUrls.length ? "" : styles.primary
                  }
                  disabled={busyPostId === selected.id}
                  onClick={() => renderPost(selected)}
                >
                  {busyPostId === selected.id
                    ? "出图中"
                    : selected.renderedImageUrls.length
                      ? "已出图"
                      : "生成配图"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={
                  busyPostId === selected.id || selected.status === "DISCARDED"
                }
                onClick={() => discardPost(selected)}
              >
                {selected.status === "DISCARDED" ? "已弃用" : "不发这条"}
              </button>
            </div>
          </div>

          <div className={styles.frames}>
            {selected.renderedImageUrls.length ? (
              selected.renderedImageUrls.map((url, index) => (
                <div className={styles.frame} key={url}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" />
                  {selected.slideOverlays[index] ? (
                    <span className={styles.overlayText}>
                      {selected.slideOverlays[index]}
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <div className={styles.frame}>
                {selected.format === "TEXT"
                  ? "纯文案 · 无需配图"
                  : selected.format === "VIDEO"
                    ? "视频请到「创作」出片"
                    : "未出图"}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <footer className={styles.foot}>
        {plan ? (
          <>
            本周已排 <span className={styles.footCount}>{posts.length}</span> 条，
            还有 <span className={styles.footCount}>{emptyDays}</span> 个空档
            {plan.generatedBy === "heuristic"
              ? " · 本次由兜底模板生成，建议重新排一次"
              : ""}
          </>
        ) : (
          "还没有本周计划"
        )}
      </footer>
    </div>
  );
}
