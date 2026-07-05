"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Clapperboard,
  Film,
  ImagePlus,
  Loader2,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type {
  UploadedAsset,
  VideoGenerationPlan,
} from "@/types/video-generation";
import {
  consumeCreatePrefill,
  uploadFilesToAssets,
} from "@/components/personal/upload-assets";

type CreateMode = "fast" | "director";
type Duration = 15 | 30 | 60;
type Ratio = "9:16" | "16:9" | "1:1";

interface DispatchResult {
  nextUrl: string;
  batch: Array<{ briefId: string; deliveryOrderId: string }>;
}

export function GlassCreateWorkflow({
  initialMode,
}: {
  initialMode: CreateMode;
}) {
  const [mode, setMode] = useState<CreateMode>(initialMode);
  const [images, setImages] = useState<UploadedAsset[]>([]);
  const [refVideo, setRefVideo] = useState<UploadedAsset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<Duration>(15);
  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [batchCount, setBatchCount] = useState(1);

  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [plan, setPlan] = useState<VideoGenerationPlan | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DispatchResult | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const log = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogs((prev) => [...prev.slice(-120), `[${ts}] ${line}`]);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  /// 从 Agent 页 / 提示词库带过来的预填
  useEffect(() => {
    const prefill = consumeCreatePrefill();
    if (!prefill) return;
    if (prefill.prompt) setPrompt(prefill.prompt);
    if (prefill.duration) setDuration(prefill.duration);
    if (prefill.mode) setMode(prefill.mode);
    if (prefill.attachments?.length) {
      setImages(prefill.attachments.filter((a) => a.type === "IMAGE"));
      const video = prefill.attachments.find((a) => a.type === "VIDEO");
      if (video) setRefVideo(video);
    }
    log("已载入 Agent / 模板带来的创作需求");
  }, [log]);

  async function handleImageFiles(files: FileList | File[] | null) {
    if (!files) return;
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 10 - images.length);
    if (list.length === 0) return;
    setError(null);
    setUploadingImages(true);
    log(`上传 ${list.length} 张产品图…`);
    try {
      const assets = await uploadFilesToAssets(list, {
        forceRole: "product_image",
      });
      setImages((prev) => [...prev, ...assets].slice(0, 10));
      log(`产品图上传完成（共 ${Math.min(images.length + list.length, 10)} 张）`);
    } catch (e) {
      setError((e as Error).message);
      log(`✗ 产品图上传失败：${(e as Error).message}`);
    } finally {
      setUploadingImages(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function handleVideoFile(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("video/")) return;
    setError(null);
    setUploadingVideo(true);
    log("上传爆款参考视频…");
    try {
      /// 参考视频用 ad_clip 角色进 pipeline（供风格/节奏参考）
      const [asset] = await uploadFilesToAssets([file], {
        forceRole: "ad_clip",
      });
      setRefVideo(asset);
      log("参考视频上传完成");
    } catch (e) {
      setError((e as Error).message);
      log(`✗ 参考视频上传失败：${(e as Error).message}`);
    } finally {
      setUploadingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  function buildRequest() {
    const attachments: UploadedAsset[] = [...images];
    if (refVideo) attachments.push(refVideo);
    return {
      userType: "personal" as const,
      rawPrompt: prompt.trim(),
      attachments,
      selectedDuration: duration,
      selectedAspectRatio: ratio,
      selectedBrandEndingMode: "none" as const,
      platform: "tiktok" as const,
      language: "zh-CN",
    };
  }

  const canPlan = prompt.trim().length >= 4 && !planning && !dispatching;

  async function generateScript() {
    if (!canPlan) return;
    setError(null);
    setPlanning(true);
    setPlan(null);
    setEditedPrompts({});
    setDone(null);
    log(`第一步：AI 解析需求并生成${mode === "director" ? "分镜脚本" : "脚本"}…`);
    try {
      const res = await fetch("/api/video-generation/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRequest()),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "脚本生成失败");
      const p = j.plan as VideoGenerationPlan;
      setPlan(p);
      const aiSegs = p.segments.filter((s) => s.type === "ai_generated_clip");
      log(`✓ 脚本已生成：${aiSegs.length} 个镜头 · 共 ${p.planPreview.breakdown.finalDurationSec}s`);
      if (!p.qualityReview.canDispatch) {
        log("⚠ 描述还需补充细节才能出片，请查看下方提示");
      } else {
        log("请检查/编辑每个镜头的脚本，然后点「确认出片」");
      }
    } catch (e) {
      setError((e as Error).message);
      log(`✗ 脚本生成失败：${(e as Error).message}`);
    } finally {
      setPlanning(false);
    }
  }

  async function confirmAndDispatch() {
    if (!plan || dispatching) return;
    setError(null);
    setDispatching(true);
    log(`第二步：确认脚本，开始生成 ${batchCount} 支成片…`);
    try {
      const confirmedPrompts = Object.entries(editedPrompts).map(
        ([order, text]) => ({ segmentOrder: Number(order), prompt: text }),
      );
      const res = await fetch("/api/video-generation/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request: buildRequest(),
          confirmedPrompts,
          batchCount,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "出片任务提交失败");
      log(`✓ 已提交 ${j.batch?.length ?? 1} 支成片任务，AI 正在逐镜头生成画面`);
      log("成片完成后可在「成片库」查看和下载（页面会自动刷新进度）");
      setDone({ nextUrl: j.nextUrl as string, batch: j.batch ?? [] });
    } catch (e) {
      setError((e as Error).message);
      log(`✗ 出片提交失败：${(e as Error).message}`);
    } finally {
      setDispatching(false);
    }
  }

  const aiSegments = plan?.segments.filter((s) => s.type === "ai_generated_clip") ?? [];

  return (
    <div className="space-y-4 pb-24">
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleImageFiles(e.target.files)}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => handleVideoFile(e.target.files)}
      />

      {/* 步骤 1：产品图片 */}
      <section className="glass-card p-5">
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2.5">
            <span className="glass-step-num">1</span>
            <h2 className="text-sm font-semibold text-white">选择产品图片</h2>
          </div>
          <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
            JPG/PNG/WebP · 最多10张
          </span>
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleImageFiles(e.dataTransfer.files);
          }}
          onClick={() => imageInputRef.current?.click()}
          className="cursor-pointer rounded-2xl border border-dashed border-white/20 bg-white/4 px-6 py-8 text-center transition-colors hover:border-sky-300/40 hover:bg-white/6"
        >
          {images.length === 0 ? (
            <div className="space-y-2">
              {uploadingImages ? (
                <Loader2 className="mx-auto h-7 w-7 animate-spin text-white/60" />
              ) : (
                <ImagePlus className="mx-auto h-7 w-7 text-white/50" />
              )}
              <p className="text-sm font-medium text-white/85">
                拖拽或点击上传产品图片
              </p>
              <p className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
                建议上传 3-5 张，包含正面/侧面/细节
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {images.map((img, idx) => (
                <div key={img.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt=""
                    className="h-20 w-20 rounded-xl border border-white/15 object-cover"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setImages((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white group-hover:flex"
                    aria-label="移除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {images.length < 10 && (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-white/20 text-white/40">
                  {uploadingImages ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-5 w-5" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 步骤 2：爆款参考视频 */}
      <section className="glass-card p-5">
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2.5">
            <span className="glass-step-num">2</span>
            <h2 className="text-sm font-semibold text-white">
              爆款参考视频（可选）
            </h2>
          </div>
          <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
            提供节奏与风格参考
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="glass-btn text-xs"
            disabled={uploadingVideo}
            onClick={() => videoInputRef.current?.click()}
          >
            {uploadingVideo ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Film className="h-3.5 w-3.5" />
            )}
            选择爆款视频
          </button>
          {refVideo ? (
            <span className="glass-chip">
              {refVideo.fileName}
              <button
                type="button"
                onClick={() => setRefVideo(null)}
                className="ml-1 text-white/60 hover:text-white"
                aria-label="移除参考视频"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
              未选择 — AI 将按你的描述自行设计节奏
            </span>
          )}
        </div>
        <p className="mt-3 rounded-xl border border-sky-300/25 bg-sky-500/12 px-3 py-2 text-xs text-sky-100/90">
          💡 上传参考视频后，AI 会解析它的镜头结构并把你的产品嵌入每一镜，复制爆款打法。
        </p>
      </section>

      {/* 步骤 3：创作模式 + 需求 */}
      <section className="glass-card p-5">
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2.5">
            <span className="glass-step-num">3</span>
            <h2 className="text-sm font-semibold text-white">创作模式与需求</h2>
          </div>
          <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
            快速=脚本直出视频 · 导演=分镜可打磨
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pb-4">
          <button
            type="button"
            onClick={() => setMode("fast")}
            className={`glass-btn text-xs ${mode === "fast" ? "is-active" : ""}`}
          >
            <Zap className="h-3.5 w-3.5" />
            快速成片
          </button>
          <button
            type="button"
            onClick={() => setMode("director")}
            className={`glass-btn text-xs ${mode === "director" ? "is-active" : ""}`}
          >
            <Clapperboard className="h-3.5 w-3.5" />
            导演分镜
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="描述你要的视频…例：15秒 UGC 口播，突出防摔卖点，美国市场，真人实拍感"
          className="glass-input resize-none"
        />

        <div className="flex flex-wrap items-center gap-4 pt-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
              时长
            </span>
            {([15, 30, 60] as Duration[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`glass-btn px-3 py-1 text-xs ${duration === d ? "is-active" : ""}`}
              >
                {d}s
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
              画幅
            </span>
            {(["9:16", "16:9", "1:1"] as Ratio[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRatio(r)}
                className={`glass-btn px-3 py-1 text-xs ${ratio === r ? "is-active" : ""}`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: "var(--glass-text-dim)" }}>
              出片数
            </span>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setBatchCount(n)}
                className={`glass-btn px-3 py-1 text-xs ${batchCount === n ? "is-active" : ""}`}
              >
                {n}支
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 脚本确认区 */}
      {plan && (
        <section className="glass-card p-5">
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2.5">
              <span className="glass-step-num">4</span>
              <h2 className="text-sm font-semibold text-white">
                镜头脚本（可编辑）
              </h2>
            </div>
            <span className="glass-chip">
              {plan.planPreview.breakdown.finalDurationSec}s ·{" "}
              {plan.planPreview.breakdown.aspectRatio} · {aiSegments.length} 镜
            </span>
          </div>

          <p className="pb-3 text-xs text-white/70">{plan.planPreview.summary}</p>

          {!plan.qualityReview.canDispatch && (
            <div className="mb-3 rounded-xl border border-amber-300/30 bg-amber-500/12 px-3 py-2 text-xs text-amber-100">
              {plan.qualityReview.blockers.map((b) => (
                <p key={b.code}>⚠ {b.message}</p>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {aiSegments.map((seg, idx) => (
              <div key={seg.id} className="glass-panel p-3.5">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-xs font-semibold text-sky-200">
                    镜头 {idx + 1} · {seg.durationSeconds}s
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--glass-text-dim)" }}>
                    {seg.purpose}
                  </span>
                </div>
                <textarea
                  value={editedPrompts[seg.order] ?? seg.prompt ?? ""}
                  onChange={(e) =>
                    setEditedPrompts((prev) => ({
                      ...prev,
                      [seg.order]: e.target.value,
                    }))
                  }
                  rows={mode === "director" ? 4 : 2}
                  className="glass-input resize-y text-xs leading-relaxed"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 日志控制台 */}
      {logs.length > 0 && (
        <div ref={logRef} className="glass-console">
          {logs.join("\n")}
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      {/* 成功卡 */}
      {done && (
        <div className="glass-card border-emerald-300/30 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-200">
            ✓ {done.batch.length || 1} 支成片任务已开始生成
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--glass-text-dim)" }}>
            AI 正在逐镜头出画面，完成后自动合成成片，可随时离开此页
          </p>
          <Link href={done.nextUrl} className="glass-btn-primary mt-4 inline-flex text-xs">
            前往成片库查看进度
          </Link>
        </div>
      )}

      {/* 底部固定操作条 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/45 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8 md:pl-[100px]">
          <span className="truncate text-xs" style={{ color: "var(--glass-text-dim)" }}>
            {dispatching
              ? "出片任务提交中…"
              : planning
                ? "脚本生成中…"
                : plan
                  ? "脚本已就绪 — 检查后确认出片"
                  : "就绪 — 填写需求后点「第一步：生成脚本」"}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {plan ? (
              <>
                <button
                  type="button"
                  onClick={generateScript}
                  disabled={planning || dispatching}
                  className="glass-btn text-xs"
                >
                  {planning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  重新生成脚本
                </button>
                <button
                  type="button"
                  onClick={confirmAndDispatch}
                  disabled={dispatching || planning || !plan.qualityReview.canDispatch}
                  className="glass-btn-primary text-xs"
                >
                  {dispatching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  确认出片（{batchCount} 支）
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={generateScript}
                disabled={!canPlan}
                className="glass-btn-primary text-xs"
              >
                {planning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>▶</>
                )}
                第一步：生成脚本
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
