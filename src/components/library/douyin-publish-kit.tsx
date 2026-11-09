"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, ImageIcon, Loader2, PenLine, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionHead } from "@/components/exchange/section-head";
import { StatusTick } from "@/components/exchange/status-tick";
import { MonoTag } from "@/components/exchange/mono-tag";
import { LocalTime } from "@/components/exchange/local-time";
import type { Locale } from "@/i18n/config";
import type { DouyinKitCopy } from "@/i18n/douyin-kit-copy";
import { checkAdLawCopy, splitByAdLawHits } from "@/lib/compliance/ad-law-terms";
import {
  cleanHashtag,
  DOUYIN_BODY_MAX,
  DOUYIN_HASHTAG_MAX,
  DOUYIN_HASHTAG_MIN,
  DOUYIN_TITLE_MAX,
  douyinCaptionText,
  douyinCopySchema,
  type DouyinCopy,
  type DouyinKitAssets,
  type DouyinKitRegistration,
} from "@/lib/contracts/douyin-publish-kit";

/**
 * 抖音发布包面板（成品库 → 成片 → 抖音发布包）。三段：文案 → 导出素材 → 发布登记。
 *
 * - 文案在浏览器里编辑，极限词检查与服务端用同一份纯函数（ad-law-terms），边改边标红；
 *   命中时不出下载按钮，服务端同样拒绝产出素材。
 * - 文案与素材地址只记在本机（localStorage），换设备要重新生成；落库的只有发布登记。
 * - 起稿与导出都能取消：中止请求即可，已有内容保留。
 * - 是不是矩阵账号（加不加 Aivora 尾卡）由服务端判定后以布尔值传入，这里不引任何服务端模块。
 */

type Busy = "copy" | "render" | "register" | "unregister" | null;

type Draft = {
  title: string;
  body: string;
  hashtags: string;
  assets: (DouyinKitAssets & { title: string }) | null;
};

const EMPTY_DRAFT: Draft = { title: "", body: "", hashtags: "", assets: null };

function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,，、]+/u)
    .map(cleanHashtag)
    .filter(Boolean);
}

/** 标红预览：只有命中时才渲染，命中词用失败色 + 下划线，读屏读得到是哪一类。 */
function AdLawPreview({ label, text }: { label: string; text: string }) {
  const parts = splitByAdLawHits(text);
  if (!parts.some((part) => part.hit)) return null;
  return (
    <p className="text-meta text-muted-foreground" data-testid="ad-law-preview">
      <span className="x-label mr-2">{label}</span>
      {parts.map((part, index) =>
        part.hit ? (
          <mark
            key={index}
            data-ad-law-term={part.hit.term}
            className="rounded-(--radius-sm) bg-danger-soft px-0.5 font-semibold text-danger underline decoration-danger underline-offset-2"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function CopyButton({ text, copy, label }: { text: string; copy: DouyinKitCopy; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function run() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }
  return (
    <Button type="button" variant="outline" size="sm" disabled={!text.trim()} onClick={() => void run()}>
      {state === "done" ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span role="status">
        {state === "done" ? copy.copied : state === "failed" ? copy.copyFailed : (label ?? copy.copyButton)}
      </span>
    </Button>
  );
}

export function DouyinPublishKit({
  orderId,
  locale,
  copy,
  matrixAccount,
  registration,
  registrationAvailable,
}: {
  orderId: string;
  locale: Locale;
  copy: DouyinKitCopy;
  /** 服务端按矩阵账号名单判定的结果：true 才会在发布版成片后接 Aivora 尾卡 */
  matrixAccount: boolean;
  registration: DouyinKitRegistration | null;
  /** false = 数据库还没有 accountLabel 列，登记表单停用 */
  registrationAvailable: boolean;
}) {
  const router = useRouter();
  const storageKey = `aivora:douyin-kit:${orderId}`;
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<{ area: "copy" | "render" | "register"; tone: "ok" | "fault"; text: string } | null>(null);
  const [accountLabel, setAccountLabel] = useState(registration?.accountLabel ?? "");
  const [publishUrl, setPublishUrl] = useState(registration?.publishUrl ?? "");
  const [note, setNote] = useState(registration?.note ?? "");
  const [confirmUnregister, setConfirmUnregister] = useState(false);
  const [pending, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setDraft({ ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) });
    } catch {
      /// localStorage 不可用（隐私模式等）：只影响刷新后的保留，功能照常
    }
  }, [storageKey]);

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /// 同上
      }
      return next;
    });
  }

  const hashtags = useMemo(() => parseHashtags(draft.hashtags), [draft.hashtags]);
  const candidate = useMemo(
    () => ({ title: draft.title, body: draft.body, hashtags }),
    [draft.title, draft.body, hashtags],
  );
  const hasCopy = Boolean(draft.title.trim() || draft.body.trim() || hashtags.length);
  const adLaw = useMemo(() => checkAdLawCopy(candidate), [candidate]);
  const parsed = useMemo(() => douyinCopySchema.safeParse(candidate), [candidate]);
  const invalidReason = hasCopy && !parsed.success ? (parsed.error.issues[0]?.message ?? null) : null;
  const exportable = parsed.success && adLaw.ok;
  const validCopy: DouyinCopy | null = parsed.success ? parsed.data : null;
  /// 封面印的是生成那一刻的标题：标题改过就不能再下那张旧封面
  const stale = Boolean(draft.assets && validCopy && draft.assets.title !== validCopy.title);
  const working = busy !== null || pending;

  function cancelWork() {
    abortRef.current?.abort();
  }

  async function call<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; aborted: boolean; code?: string; error?: string }> {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as (T & { ok?: boolean; code?: string; error?: string; message?: string }) | null;
      if (!response.ok || !json || json.ok === false) {
        return { ok: false, aborted: false, code: json?.code, error: json?.error ?? json?.message };
      }
      return { ok: true, data: json };
    } catch {
      return { ok: false, aborted: controller.signal.aborted };
    } finally {
      abortRef.current = null;
    }
  }

  async function generateCopy() {
    setBusy("copy");
    setFeedback(null);
    const result = await call<{ copy: DouyinCopy }>(`/api/library/${orderId}/douyin-kit`, { action: "copy" });
    setBusy(null);
    if (!result.ok) {
      /// LLM 失败就是失败：把服务端的原话给出来，不替它编一版文案
      setFeedback({
        area: "copy",
        tone: result.aborted ? "ok" : "fault",
        text: result.aborted ? copy.cancelled : (result.error ?? copy.networkError),
      });
      return;
    }
    updateDraft({
      title: result.data.copy.title,
      body: result.data.copy.body,
      hashtags: result.data.copy.hashtags.join(" "),
    });
  }

  async function renderAssets(includeVideo: boolean) {
    if (!validCopy || !adLaw.ok) return;
    setBusy("render");
    setFeedback(null);
    const result = await call<{ assets: DouyinKitAssets }>("/api/brand-packaging", {
      douyinKit: { orderId, copy: validCopy, includeVideo },
    });
    setBusy(null);
    if (!result.ok) {
      setFeedback({
        area: "render",
        tone: result.aborted ? "ok" : "fault",
        text: result.aborted ? copy.cancelled : (result.error ?? copy.networkError),
      });
      return;
    }
    const previous = draft.assets;
    updateDraft({
      assets: {
        ...result.data.assets,
        /// 只换封面时沿用已有的发布版成片
        videoUrl: result.data.assets.videoUrl ?? previous?.videoUrl ?? null,
        endCard: result.data.assets.videoUrl ? result.data.assets.endCard : (previous?.endCard ?? false),
        title: validCopy.title,
      },
    });
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountLabel.trim() || working) return;
    setBusy("register");
    setFeedback(null);
    const result = await call<{ registration: DouyinKitRegistration }>(`/api/library/${orderId}/douyin-kit`, {
      action: "register",
      accountLabel,
      publishUrl,
      note,
    });
    setBusy(null);
    if (!result.ok) {
      setFeedback({
        area: "register",
        tone: result.aborted ? "ok" : "fault",
        text: result.aborted ? copy.cancelled : (result.error ?? copy.networkError),
      });
      return;
    }
    setFeedback({ area: "register", tone: "ok", text: copy.registerDone });
    startTransition(() => router.refresh());
  }

  async function unregister() {
    setBusy("unregister");
    setFeedback(null);
    const result = await call<{ cancelled: number }>(`/api/library/${orderId}/douyin-kit`, { action: "unregister" });
    setBusy(null);
    setConfirmUnregister(false);
    if (!result.ok) {
      setFeedback({ area: "register", tone: "fault", text: result.error ?? copy.networkError });
      return;
    }
    setFeedback({ area: "register", tone: "ok", text: copy.unregisterDone });
    startTransition(() => router.refresh());
  }

  const feedbackFor = (area: "copy" | "render" | "register") =>
    feedback?.area === area ? (
      <p role="status" className={feedback.tone === "fault" ? "text-meta text-danger" : "text-meta text-muted-foreground"}>
        {feedback.text}
      </p>
    ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="douyin-publish-kit">
      {/* ---------- 文案 ---------- */}
      <section className="x-panel flex min-w-0 flex-col gap-4 p-4 sm:p-5" aria-label={copy.copyTitle}>
        <SectionHead
          title={copy.copyTitle}
          hint={copy.copyHint}
          action={
            busy === "copy" ? (
              <Button type="button" variant="outline" size="sm" onClick={cancelWork}>
                <X aria-hidden />
                {copy.cancel}
              </Button>
            ) : (
              <Button type="button" variant={hasCopy ? "outline" : "default"} size="sm" disabled={working} onClick={() => void generateCopy()}>
                <PenLine aria-hidden />
                {hasCopy ? copy.regenerateCopy : copy.generateCopy}
              </Button>
            )
          }
        />
        {busy === "copy" ? (
          <p role="status" className="flex items-center gap-2 text-meta text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            {copy.generatingCopy}
          </p>
        ) : null}
        {feedbackFor("copy")}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-3">
            <label htmlFor="douyin-title" className="text-body font-semibold text-foreground">
              {copy.fieldTitle}
              <span className="ml-2 font-normal text-meta text-tertiary">
                {copy.fieldTitleHint.replace("{max}", String(DOUYIN_TITLE_MAX))}
              </span>
            </label>
            <CopyButton text={draft.title} copy={copy} />
          </div>
          <Input
            id="douyin-title"
            value={draft.title}
            maxLength={DOUYIN_TITLE_MAX + 20}
            disabled={busy === "copy"}
            aria-invalid={adLaw.hits.some((hit) => hit.field === "title") || undefined}
            onChange={(event) => updateDraft({ title: event.target.value })}
          />
          <p className="self-end font-mono text-meta tabular-nums text-tertiary">
            {Array.from(draft.title.trim()).length}/{DOUYIN_TITLE_MAX}
          </p>
          <AdLawPreview label={copy.adLawIn.title} text={draft.title} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-3">
            <label htmlFor="douyin-body" className="text-body font-semibold text-foreground">
              {copy.fieldBody}
              <span className="ml-2 font-normal text-meta text-tertiary">
                {copy.fieldBodyHint.replace("{max}", String(DOUYIN_BODY_MAX))}
              </span>
            </label>
            <CopyButton text={draft.body} copy={copy} />
          </div>
          <Textarea
            id="douyin-body"
            value={draft.body}
            disabled={busy === "copy"}
            aria-invalid={adLaw.hits.some((hit) => hit.field === "body") || undefined}
            onChange={(event) => updateDraft({ body: event.target.value })}
          />
          <p className="self-end font-mono text-meta tabular-nums text-tertiary">
            {Array.from(draft.body.trim()).length}/{DOUYIN_BODY_MAX}
          </p>
          <AdLawPreview label={copy.adLawIn.body} text={draft.body} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-3">
            <label htmlFor="douyin-hashtags" className="text-body font-semibold text-foreground">
              {copy.fieldHashtags}
              <span className="ml-2 font-normal text-meta text-tertiary">
                {copy.fieldHashtagsHint
                  .replace("{min}", String(DOUYIN_HASHTAG_MIN))
                  .replace("{max}", String(DOUYIN_HASHTAG_MAX))}
              </span>
            </label>
            <CopyButton text={hashtags.map((tag) => `#${tag}`).join(" ")} copy={copy} />
          </div>
          <Input
            id="douyin-hashtags"
            value={draft.hashtags}
            disabled={busy === "copy"}
            aria-invalid={adLaw.hits.some((hit) => hit.field === "hashtag") || undefined}
            onChange={(event) => updateDraft({ hashtags: event.target.value })}
          />
          {hashtags.length > 0 ? (
            <p className="flex flex-wrap gap-1.5">
              {hashtags.map((tag, index) => (
                <MonoTag key={`${tag}-${index}`}>#{tag}</MonoTag>
              ))}
            </p>
          ) : null}
          <AdLawPreview label={copy.adLawIn.hashtag} text={hashtags.map((tag) => `#${tag}`).join(" ")} />
        </div>

        {!adLaw.ok ? (
          <div role="alert" data-testid="ad-law-block" className="x-well flex items-start gap-2 rounded-(--radius-md) border border-danger px-3 py-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 space-y-1">
              <p className="text-body font-semibold text-danger">
                {copy.adLawTitle}
                <span className="ml-2 font-mono text-data tabular-nums">{adLaw.hits.length}</span>
              </p>
              <p className="flex flex-wrap gap-1.5">
                {adLaw.terms.map((term) => (
                  <span key={term} className="rounded-(--radius-sm) bg-danger-soft px-1.5 py-0.5 text-meta font-semibold text-danger">
                    {term}
                  </span>
                ))}
              </p>
              <p className="text-meta text-muted-foreground">{copy.adLawHint}</p>
            </div>
          </div>
        ) : invalidReason ? (
          <p role="status" className="text-meta text-gold">
            {copy.invalidTitle}：{invalidReason}
          </p>
        ) : null}

        {validCopy && adLaw.ok ? (
          <div className="flex flex-wrap justify-end gap-2">
            <CopyButton text={douyinCaptionText(validCopy)} copy={copy} label={copy.copyAll} />
          </div>
        ) : null}
      </section>

      {/* ---------- 导出素材 ---------- */}
      <section className="x-panel flex min-w-0 flex-col gap-4 p-4 sm:p-5" aria-label={copy.assetsTitle}>
        <SectionHead
          title={copy.assetsTitle}
          hint={copy.assetsHint}
          action={
            busy === "render" ? (
              <Button type="button" variant="outline" size="sm" onClick={cancelWork}>
                <X aria-hidden />
                {copy.cancel}
              </Button>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                {stale && draft.assets?.videoUrl ? (
                  <Button type="button" variant="outline" size="sm" disabled={working || !exportable} onClick={() => void renderAssets(false)}>
                    <ImageIcon aria-hidden />
                    {copy.renderCoverOnly}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={draft.assets ? "outline" : "default"}
                  size="sm"
                  disabled={working || !exportable}
                  onClick={() => void renderAssets(true)}
                >
                  <Download aria-hidden />
                  {draft.assets ? copy.rerenderAssets : copy.renderAssets}
                </Button>
              </span>
            )
          }
        />
        <p className="text-meta text-muted-foreground">
          <span className="x-label mr-2">{copy.readingEndCard}</span>
          {matrixAccount ? copy.endCardOnHint : copy.endCardOffHint}
        </p>
        {busy === "render" ? (
          <p role="status" className="flex items-center gap-2 text-meta text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            {copy.rendering}
          </p>
        ) : !exportable ? (
          <p className="text-meta text-muted-foreground">{hasCopy ? copy.renderBlocked : copy.renderNeedCopy}</p>
        ) : null}
        {feedbackFor("render")}

        {draft.assets ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <figure className="flex min-w-0 flex-col gap-2">
              <figcaption className="flex flex-wrap items-center gap-2 text-body font-semibold text-foreground">
                {copy.video}
                <MonoTag>{copy.videoBadge}</MonoTag>
                {draft.assets.endCard ? <MonoTag>{copy.videoEndCard}</MonoTag> : null}
              </figcaption>
              {draft.assets.videoUrl ? (
                <video
                  controls
                  preload="metadata"
                  poster={draft.assets.coverUrl}
                  src={draft.assets.videoUrl}
                  className="max-h-[60vh] w-auto max-w-full self-start rounded-(--radius-md)"
                  data-testid="douyin-kit-video"
                />
              ) : null}
              {draft.assets.videoUrl && exportable ? (
                <Button render={<a href={draft.assets.videoUrl} download={`aivora-douyin-${orderId}.mp4`} target="_blank" rel="noreferrer" />} size="sm" className="self-start">
                  <Download aria-hidden />
                  {copy.downloadVideo}
                </Button>
              ) : null}
            </figure>
            <figure className="flex min-w-0 flex-col gap-2">
              <figcaption className="text-body font-semibold text-foreground">{copy.cover}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element -- 对象存储上的导出素材，按原图给运营下载，不走图片优化 */}
              <img
                src={draft.assets.coverUrl}
                alt={`${copy.cover}：${draft.assets.title}`}
                className="max-h-[60vh] w-auto max-w-full self-start rounded-(--radius-md)"
                data-testid="douyin-kit-cover"
              />
              {exportable && !stale ? (
                <Button render={<a href={draft.assets.coverUrl} download={`aivora-douyin-${orderId}-cover.jpg`} target="_blank" rel="noreferrer" />} variant="outline" size="sm" className="self-start">
                  <Download aria-hidden />
                  {copy.downloadCover}
                </Button>
              ) : null}
            </figure>
          </div>
        ) : null}
        {stale ? (
          <p role="status" className="text-meta text-gold">
            {copy.renderStale}
          </p>
        ) : null}

        <p className="x-well flex items-start gap-2 rounded-(--radius-md) px-3 py-2" data-testid="ai-declaration-reminder">
          <Check className="mt-0.5 size-4 shrink-0 text-iris" aria-hidden />
          <span className="min-w-0">
            <span className="block text-body font-semibold text-foreground">{copy.aiDeclaration}</span>
            <span className="block text-meta text-muted-foreground">{copy.aiDeclarationHint}</span>
          </span>
        </p>
      </section>

      {/* ---------- 发布登记 ---------- */}
      <section className="x-panel flex min-w-0 flex-col gap-4 p-4 sm:p-5" aria-label={copy.registerTitle}>
        <SectionHead
          title={copy.registerTitle}
          hint={copy.registerHint}
          action={<StatusTick entity="publish" state={registration ? "logged" : "unlogged"} locale={locale} />}
        />
        {!registrationAvailable ? (
          <p role="status" className="text-meta text-gold">
            {copy.registrationUnavailable}
          </p>
        ) : null}
        {registration ? (
          <dl className="x-well grid gap-x-6 gap-y-2 rounded-(--radius-md) px-3 py-2 text-meta sm:grid-cols-[auto_1fr]" data-testid="douyin-registration">
            <dt className="text-tertiary">{copy.registered}</dt>
            <dd className="min-w-0 break-words font-semibold text-foreground">{registration.accountLabel ?? "—"}</dd>
            <dt className="text-tertiary">{copy.registeredAt}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              <LocalTime iso={registration.registeredAt} locale={locale} variant="date" />{" "}
              <LocalTime iso={registration.registeredAt} locale={locale} variant="time" />
            </dd>
            {registration.publishUrl ? (
              <>
                <dt className="text-tertiary">{copy.publishLink}</dt>
                <dd className="min-w-0 break-all">
                  <a href={registration.publishUrl} target="_blank" rel="noreferrer" className="text-accent underline-offset-4 hover:underline">
                    {registration.publishUrl}
                  </a>
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
        <form onSubmit={register} className="grid min-w-0 gap-3 sm:grid-cols-2" data-testid="douyin-register-form">
          <label className="flex min-w-0 flex-col gap-1.5 text-body font-semibold text-foreground">
            {copy.accountLabel}
            <Input
              value={accountLabel}
              maxLength={60}
              required
              disabled={!registrationAvailable || working}
              placeholder={copy.accountPlaceholder}
              onChange={(event) => setAccountLabel(event.target.value)}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-body font-semibold text-foreground">
            {copy.publishUrl}
            <Input
              type="url"
              value={publishUrl}
              maxLength={500}
              disabled={!registrationAvailable || working}
              placeholder={copy.publishUrlPlaceholder}
              onChange={(event) => setPublishUrl(event.target.value)}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-body font-semibold text-foreground sm:col-span-2">
            {copy.note}
            <Input
              value={note}
              maxLength={500}
              disabled={!registrationAvailable || working}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" size="sm" variant={registration ? "outline" : "default"} disabled={!registrationAvailable || working || !accountLabel.trim()}>
              {busy === "register" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {busy === "register" ? copy.registering : registration ? copy.updateRegistration : copy.register}
            </Button>
            {registration && !confirmUnregister ? (
              <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => setConfirmUnregister(true)}>
                {copy.unregister}
              </Button>
            ) : null}
            {registration && confirmUnregister ? (
              <>
                <Button type="button" variant="destructive" size="sm" disabled={working} onClick={() => void unregister()}>
                  {busy === "unregister" ? copy.unregistering : copy.unregisterConfirm}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => setConfirmUnregister(false)}>
                  {copy.unregisterKeep}
                </Button>
                <span className="basis-full text-meta text-muted-foreground">{copy.unregisterHint}</span>
              </>
            ) : null}
          </div>
        </form>
        {feedbackFor("register")}
      </section>
    </div>
  );
}
