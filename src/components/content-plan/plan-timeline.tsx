"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { FillBar } from "@/components/exchange/fill-bar";
import { StatusTick } from "@/components/exchange/status-tick";
import { WorkspacePage } from "@/components/exchange/workspace-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { useTranslation } from "@/i18n/useTranslation";
import {
  isContentPostRenderActive,
  type ContentPostRenderView,
  type ContentPostSlideView,
} from "@/lib/contracts/content-post-render";
import { cn } from "@/lib/utils";
import { PLAN_DAYS, apiErrorMessage, planDayDates, planTodayOffset } from "./plan-week";
import styles from "./plan-timeline.module.css";

/**
 * O1 · 一周内容时间线（PRD §3 + §11）。
 *
 * 注意：这是 client 组件，**不得 import 任何服务端 service**。
 * 取了服务端模块的值会把 OpenAI / Prisma 打进浏览器 bundle，整页 500。
 * 有 client-bundle-safety 回归测试守着，别绕过它。
 * 所有数据都由 server component 以纯 DTO 传进来（出图视图的形状来自 contracts/content-post-render）。
 *
 * 1025 · B2.3：控件一律用共享 Button / Input（不再在 CSS module 里自写按钮）；
 * 文案全部来自 platform-copy（中英双语）；「今天」在浏览器按计划起始日 + dayOffset 算。
 *
 * C2：配图改走 Shuyu 异步出图——点「生成配图」只是开一轮（202），之后每 2.5 秒拉一次 GET
 * （页面回到前台立即补一拍），按每屏状态显示进度；出图中可以「停止出图」。刷新页面能接着看。
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
  /// 出图视图（只有单图 / 轮播有）：是否在出图、每屏状态。null = 文案 / 视频帖。
  render: ContentPostRenderView | null;
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
  /// 计划起始时刻（ISO）：第 dayOffset 天 = 起始日 + dayOffset，按访问者时区落到日历上。
  startIso: string;
  posts: TimelinePost[];
};

type PlanCopy = ReturnType<typeof getPlatformCopy>["plan"];

/// 前端轮询间隔：与创作台故事板同一个节拍。服务端对同一张图查供应商另有节流。
const RENDER_POLL_MS = 2_500;

/** 结构代码：`hookType · 形态`（如 `POV · 单图`），不把内部 recipeId 原值摆给商家。 */
function shotSlug(post: TimelinePost, copy: PlanCopy): string {
  return `${post.hookType ?? "—"} · ${copy.formats[post.format]}`;
}

function subscribeNever() {
  return () => undefined;
}

/** 水合后才为 true：日期只在浏览器里算，服务端（UTC）先渲染不带日期的占位。 */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/** 服务端回来的出图视图落到帖子上：状态、按位置的图、原因都以服务端为准。 */
function withRender(post: TimelinePost, render: ContentPostRenderView): TimelinePost {
  return {
    ...post,
    status: render.status,
    renderedImageUrls: render.renderedImageUrls,
    renderError: render.renderError,
    render,
  };
}

/** 画框按「屏」排，不按 URL 排：轮播中途失败会留空位，空位也要占住自己的位置。 */
function frameSlots(post: TimelinePost): ContentPostSlideView[] {
  if (post.render && post.render.total > 0) return post.render.slides;
  return post.renderedImageUrls.map((url, index) => ({
    index,
    state: url.trim() ? "done" : "missing",
    imageUrl: url.trim() ? url : null,
    note: null,
  }));
}

async function readRender(res: Response): Promise<{ body: unknown; render: ContentPostRenderView | null }> {
  const body = await res.json().catch(() => null);
  const render =
    body && typeof body === "object" && "render" in body
      ? ((body as { render?: ContentPostRenderView }).render ?? null)
      : null;
  return { body, render };
}

export function PlanTimeline({ plan }: { plan: TimelinePlan | null }) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).plan;
  const hydrated = useHydrated();
  const [sentence, setSentence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    plan?.posts[0]?.key ?? null,
  );
  const [pending, startTransition] = useTransition();
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [posts, setPosts] = useState<TimelinePost[]>(plan?.posts ?? []);

  /// 没有计划时，空的一周从今天开始画（排出来的计划也是从今天起）。
  const days = useMemo(() => {
    if (!hydrated) return null;
    const startIso = plan?.startIso ?? new Date().toISOString();
    const now = new Date();
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
    const monthDay = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" });
    return {
      todayOffset: planTodayOffset(startIso, now),
      labels: planDayDates(startIso).map((date) => ({ weekday: weekday.format(date), date: monthDay.format(date) })),
    };
  }, [hydrated, locale, plan?.startIso]);
  const todayOffset = days?.todayOffset ?? null;

  const byDay = useMemo(() => {
    const lanes: TimelinePost[][] = Array.from({ length: PLAN_DAYS }, () => []);
    for (const post of posts) {
      lanes[Math.min(PLAN_DAYS - 1, Math.max(0, post.dayOffset))].push(post);
    }
    return lanes;
  }, [posts]);

  /// 正在出图（含停止后收回中）的帖子：只要还有，就一直轮询它们的 GET（GET 同时在服务端推进对账）。
  const renderingIds = posts
    .filter((post) => isContentPostRenderActive(post.render))
    .map((post) => post.id)
    .join(",");
  const planId = plan?.id ?? null;
  useEffect(() => {
    if (!renderingIds || !planId) return;
    const ids = renderingIds.split(",");
    let cancelled = false;
    let timer = 0;
    /// 同一时刻只有一拍在路上：切回前台补的那一拍不能和定时的那一拍叠成两条轮询链。
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const views = await Promise.all(
        ids.map(async (postId) => {
          try {
            const res = await fetch(`/api/content-plans/${planId}/posts/${postId}/render`, {
              cache: "no-store",
            });
            const { render } = await readRender(res);
            return res.ok ? render : null;
          } catch {
            /// 浏览器侧的瞬时错误不影响后台出图；下一拍再拉。
            return null;
          }
        }),
      );
      polling = false;
      if (cancelled) return;
      const updates = views.filter((view): view is ContentPostRenderView => view !== null);
      if (updates.length > 0) {
        setPosts((current) =>
          current.map((post) => {
            const next = updates.find((view) => view.postId === post.id);
            return next ? withRender(post, next) : post;
          }),
        );
      }
      /// 还在出图的集合没变时 effect 不会重跑，这里自己续上下一拍；集合变了由重跑接管。
      timer = window.setTimeout(poll, RENDER_POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || cancelled || polling) return;
      window.clearTimeout(timer);
      void poll();
    };
    timer = window.setTimeout(poll, RENDER_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [planId, renderingIds]);

  const selected = posts.find((post) => post.key === selectedKey) ?? null;
  // 本周读数：弃用的不算排上；出图中的不算待出图（已经点过了）；空档按「这一天一条都没有」数。
  const live = posts.filter((post) => post.status !== "DISCARDED");
  const ready = live.filter((post) => post.status === "READY").length;
  const rendering = live.filter((post) => isContentPostRenderActive(post.render)).length;
  const draft = live.length - ready - rendering;
  const openDays = byDay.filter((lane) => !lane.some((post) => post.status !== "DISCARDED")).length;

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
        /// 幂等键按「这一次点击」取（提交中按钮已禁用，防的是同一次请求的重发）。
        /// 1025 真机验收：原来按输入内容取，「重新排一周」同一句话永远回放旧计划（兜底计划还提示
        /// 「建议重新排一次」）；而且只截前 60 个 base64 字符，开头相同的两句话会拿到对方的计划。
        idempotencyKey: `plan-${crypto.randomUUID()}`,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(apiErrorMessage(body, copy.createFailed));
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
      const { body, render } = await readRender(res);
      if (!res.ok) {
        setError(apiErrorMessage(body, copy.renderFailed));
        return;
      }
      if (render) {
        /// Shuyu 异步线路：202 = 这一轮开始了（或本来就在出图），之后由轮询接着推进。
        setPosts((current) => current.map((item) => (item.id === post.id ? withRender(item, render) : item)));
        return;
      }
      /// 同步回滚线路（CONTENT_POST_IMAGE_PROVIDER=openai）：请求返回时图已出齐。
      const urls = (body as { urls?: string[] } | null)?.urls ?? [];
      setPosts((current) =>
        current.map((item) =>
          item.id === post.id
            ? {
                ...item,
                renderedImageUrls: urls,
                status: "READY",
                renderError: null,
              }
            : item,
        ),
      );
    } catch {
      setError(copy.renderFailed);
    } finally {
      setBusyPostId(null);
    }
  }

  /**
   * 停止这一轮出图（铁律：每轮任务都要能取消）：没提交的不再提交，已提交的照常收回、素材保留；
   * 帖子留在草稿，之后「补齐配图」只补缺的那几张。
   */
  async function stopRender(post: TimelinePost) {
    setError(null);
    setBusyPostId(post.id);
    try {
      const res = await fetch(`/api/content-plans/${plan?.id}/posts/${post.id}/render/cancel`, {
        method: "POST",
      });
      const { body, render } = await readRender(res);
      if (!res.ok || !render) {
        setError(apiErrorMessage(body, copy.stopFailed));
        return;
      }
      setPosts((current) => current.map((item) => (item.id === post.id ? withRender(item, render) : item)));
    } catch {
      setError(copy.stopFailed);
    } finally {
      setBusyPostId(null);
    }
  }

  /**
   * 取消这一轮。铁律：每轮任务都要能取消，且取消**保留已出的素材**。
   * 失败时只给「重试」是不够的。
   */
  async function discardPost(post: TimelinePost) {
    setError(null);
    setBusyPostId(post.id);
    try {
      const res = await fetch(`/api/content-plans/${plan?.id}/posts/${post.id}/render`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(apiErrorMessage(body, copy.discardFailed));
        return;
      }
      setPosts((current) =>
        current.map((item) =>
          item.id === post.id
            ? {
                ...item,
                status: "DISCARDED",
                render: item.render ? { ...item.render, status: "DISCARDED", state: "discarded", canStop: false } : null,
              }
            : item,
        ),
      );
    } catch {
      setError(copy.discardFailed);
    } finally {
      setBusyPostId(null);
    }
  }

  /// 一页一枚实心主钮：还没有计划时是「排一周」；有了计划，主行动是选中帖子的「生成配图」，重排降为描边。
  /// 只有草稿能出图；半套轮播（有图但还是草稿）点同一个钮补齐缺的那几张。已出图 / 已弃用 / 正在出图不再触发付费出图。
  const selectedRender = selected?.render ?? null;
  const selectedRendering = isContentPostRenderActive(selectedRender);
  const canRender =
    selected !== null &&
    !selectedRendering &&
    (selected.format === "SINGLE_IMAGE" || selected.format === "CAROUSEL") &&
    selected.status === "DRAFT";
  const progressText = selectedRender
    ? copy.renderProgress
        .replace("{done}", String(selectedRender.done))
        .replace("{total}", String(selectedRender.total))
    : null;
  const slots = selected ? frameSlots(selected) : [];
  const slotCounts = {
    completed: slots.filter((slot) => slot.state === "done").length,
    running: slots.filter((slot) => slot.state === "generating").length,
    paused: 0,
    failed: slots.filter((slot) => slot.state === "failed").length,
    cancelled: slots.filter((slot) => slot.state === "cancelled").length,
  };

  return (
    <WorkspacePage
      nav="plan"
      locale={locale}
      testId="plan-week"
      className={styles.root}
      subtitle={
        plan ? (
          <>
            <span className="text-foreground">{plan.theme}</span>
            {` · ${plan.targetAudience} · ${plan.corePainPoint}`}
          </>
        ) : (
          copy.subtitle
        )
      }
      primaryAction={null}
      readingsLabel={copy.readingsLabel}
      readings={[
        { label: copy.scheduled, value: live.length, caption: copy.scheduledCaption },
        { label: copy.ready, value: ready, tone: ready > 0 ? "filled" : "neutral", caption: copy.readyCaption },
        {
          label: copy.draft,
          value: draft,
          tone: draft > 0 ? "winner" : "neutral",
          caption: rendering > 0 ? copy.draftRenderingCaption.replace("{n}", String(rendering)) : copy.draftCaption,
        },
        { label: copy.open, value: openDays, tone: openDays > 0 ? "winner" : "neutral", caption: copy.openCaption },
      ]}
      scope={copy.scope}
    >
      <div className={styles.head}>
        <form
          className={styles.intake}
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(createPlan);
          }}
        >
          <Input
            value={sentence}
            onChange={(event) => setSentence(event.target.value)}
            placeholder={copy.inputPlaceholder}
            aria-label={copy.inputLabel}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant={plan ? "outline" : "default"} disabled={pending || !sentence.trim()}>
            {pending ? copy.submitting : plan ? copy.replan : copy.submit}
          </Button>
        </form>
        {plan?.planBasis ? (
          <p className={styles.basis}>{plan.planBasis}</p>
        ) : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      </div>

      <section className={styles.track} aria-label={copy.trackLabel}>
        <div className={styles.trackInner}>
          {/* 光针：今天（只在今天落在这 7 天里时画） */}
          {todayOffset !== null ? (
            <div
              className={styles.playhead}
              style={{ left: `${((todayOffset + 0.5) / PLAN_DAYS) * 100}%` }}
              aria-hidden="true"
            />
          ) : null}
          <div className={styles.ruler}>
            {Array.from({ length: PLAN_DAYS }, (_, index) => {
              const label = days?.labels[index];
              return (
                <div
                  key={index}
                  className={cn(styles.tick, index === todayOffset && styles.tickToday)}
                >
                  <span>{label ? label.weekday : `D${index + 1}`}</span>
                  <span>{index === todayOffset ? copy.today : label ? label.date : ""}</span>
                </div>
              );
            })}
          </div>
          <div className={styles.lanes}>
            {byDay.map((lane, index) => (
              <div key={index} className={styles.lane}>
                {lane.length === 0 ? (
                  /* 空档画成真的缺口，不是留白 */
                  <div className={styles.hole}>{copy.hole}</div>
                ) : (
                  lane.map((post) => (
                    <button
                      type="button"
                      key={post.key}
                      onClick={() => setSelectedKey(post.key)}
                      className={cn(
                        styles.clip,
                        post.key === selectedKey && styles.clipSelected,
                        post.status === "READY" && styles.clipReady,
                        isContentPostRenderActive(post.render) && styles.clipRendering,
                        post.status === "DISCARDED" && styles.clipDiscarded,
                      )}
                      aria-pressed={post.key === selectedKey}
                    >
                      <span className={styles.shotSlug}>{shotSlug(post, copy)}</span>
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
        <section className={styles.detail} aria-label={copy.detailLabel}>
          <div>
            <p className={styles.label}>{shotSlug(selected, copy)}</p>
            <h2 className={styles.hook}>{selected.copyHook}</h2>
            <p className={styles.body}>{selected.copyBody}</p>
            {selected.copyCta ? (
              <>
                <p className={styles.label}>{copy.cta}</p>
                <p className={styles.body}>{selected.copyCta}</p>
              </>
            ) : null}
            {selected.hashtags.length > 0 ? (
              <>
                <p className={styles.label}>{copy.hashtags}</p>
                <ul className={styles.tags}>
                  {selected.hashtags.map((tag) => (
                    <li key={tag} className={styles.tag}>
                      #{tag}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className={cn(styles.label, styles.labelSpaced)}>{copy.why}</p>
            <p className={styles.body}>{selected.rationale}</p>

            {selectedRendering && selectedRender ? (
              /* 出图进度：每屏一段（已出图 / 生成中 / 失败 / 已取消，余下是排队空档），数字等宽 */
              <div className={styles.progress} data-testid="plan-render-progress">
                <div className={styles.progressHead}>
                  <StatusTick entity="slide" state="generating" locale={locale} />
                  <span className={styles.progressCount}>{progressText}</span>
                </div>
                <FillBar counts={slotCounts} total={Math.max(slots.length, 1)} label={progressText ?? undefined} />
                <p className={styles.progressNote}>
                  {selectedRender.state === "stopping"
                    ? copy.stoppingNote.replace("{n}", String(selectedRender.inFlight))
                    : copy.renderingNote}
                </p>
              </div>
            ) : null}

            {selected.renderError && !selectedRendering ? (
              <p className={styles.error}>{selected.renderError}</p>
            ) : null}

            <div className={styles.actions}>
              {selected.format === "SINGLE_IMAGE" ||
              selected.format === "CAROUSEL" ? (
                <Button
                  type="button"
                  variant={canRender ? "default" : "outline"}
                  disabled={busyPostId === selected.id || !canRender}
                  onClick={() => renderPost(selected)}
                >
                  {busyPostId === selected.id || selectedRendering
                    ? copy.rendering
                    : selected.status === "READY"
                      ? copy.rendered
                      : selected.renderedImageUrls.some((url) => url.trim())
                        ? copy.renderMissing
                        : copy.render}
                </Button>
              ) : null}
              {selectedRender?.canStop ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyPostId === selected.id}
                  onClick={() => stopRender(selected)}
                >
                  {copy.stop}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={
                  busyPostId === selected.id || selected.status === "DISCARDED"
                }
                onClick={() => discardPost(selected)}
              >
                {selected.status === "DISCARDED" ? copy.discarded : copy.discard}
              </Button>
            </div>
          </div>

          <div className={styles.frames}>
            {slots.length ? (
              slots.map((slot) => (
                /* 按屏的序号做 key：空位是 ""，按 URL 做 key 会撞 */
                <div className={styles.frame} key={slot.index} title={slot.note ?? undefined}>
                  {slot.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={slot.imageUrl} alt={copy.slideLabel.replace("{n}", String(slot.index + 1))} />
                  ) : slot.state === "missing" ? (
                    <span>{copy.frameEmpty}</span>
                  ) : (
                    <StatusTick entity="slide" state={slot.state} locale={locale} />
                  )}
                  {selected.slideOverlays[slot.index] ? (
                    <span className={styles.overlayText}>
                      {selected.slideOverlays[slot.index]}
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <div className={styles.frame}>
                {selected.format === "TEXT"
                  ? copy.frameText
                  : selected.format === "VIDEO"
                    ? copy.frameVideo
                    : copy.frameEmpty}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {plan?.generatedBy === "heuristic" ? (
        <footer className={styles.foot}>{copy.heuristic}</footer>
      ) : null}
    </WorkspacePage>
  );
}
