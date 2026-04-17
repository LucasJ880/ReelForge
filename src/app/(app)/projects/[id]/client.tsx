"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles,
  Video,
  Send,
  BarChart3,
  Trash2,
  Loader2,
  Play,
  AlertCircle,
  CheckCircle2,
  Pencil,
  Save,
  X,
  RefreshCw,
  Heart,
  MessageCircle,
  Share2,
  Download,
  Scissors,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { StatusStepper } from "@/components/project/status-stepper";
import { StatusBadge } from "@/components/project/status-badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ProjectWithRelations, ContentAngle } from "@/types";
import { useIsAdmin } from "@/lib/hooks/use-role";

export function ProjectDetailClient({
  project: initial,
}: {
  project: ProjectWithRelations;
}) {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [project, setProject] = useState(initial);
  const [generating, setGenerating] = useState(false);
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ script: "", caption: "", videoPrompt: "" });
  const [saving, setSaving] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(15);
  const [stitching, setStitching] = useState(false);
  const [stitchProgress, setStitchProgress] = useState(0);
  const [stitchedUrl, setStitchedUrl] = useState<string | null>(null);
  const stitchAttempted = useRef(false);

  useEffect(() => { setProject(initial); }, [initial]);

  const isVideoGenerating = project.status === "VIDEO_GENERATING";

  const pollVideoStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/video`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.progress !== undefined) setVideoProgress(data.progress);
      if (data.status === "COMPLETED") { toast.success("视频生成完成"); router.refresh(); }
      else if (data.status === "FAILED") { toast.error("视频生成失败"); router.refresh(); }
    } catch { /* silent */ }
  }, [project.id, router]);

  useEffect(() => {
    if (!isVideoGenerating) return;
    const interval = setInterval(pollVideoStatus, 3000);
    pollVideoStatus();
    return () => clearInterval(interval);
  }, [isVideoGenerating, pollVideoStatus]);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/generate`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "生成失败"); }
      toast.success("内容方案已生成");
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "生成失败"); }
    finally { setGenerating(false); }
  }

  async function handleVideoGenerate() {
    if (videoSubmitting) return;
    setVideoSubmitting(true);
    setVideoProgress(0);
    setStitchedUrl(null);
    stitchAttempted.current = false;
    try {
      if (selectedDuration > 15 && !project.contentPlan?.videoPromptPart2) {
        const genRes = await fetch(`/api/projects/${project.id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetDuration: selectedDuration }),
        });
        if (!genRes.ok) { const err = await genRes.json(); throw new Error(err.error || "内容生成失败"); }
        toast.info("已生成 30 秒两段式内容方案");
      }
      const res = await fetch(`/api/projects/${project.id}/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: selectedDuration }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "视频生成失败"); }
      toast.info(selectedDuration > 15 ? "30 秒视频生成已提交（分两段）" : "视频生成已提交");
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "视频生成失败"); }
    finally { setVideoSubmitting(false); }
  }

  async function handlePublish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/publish`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "发布失败"); }
      toast.success("已成功发布到 TikTok");
      setConfirmPublish(false);
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "发布失败"); }
    finally { setPublishing(false); }
  }

  function startEditing() {
    if (!cp) return;
    setEditData({ script: cp.script, caption: cp.caption, videoPrompt: cp.videoPrompt });
    setEditing(true);
  }

  async function handleSaveEdit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "保存失败"); }
      toast.success("内容已更新");
      setEditing(false);
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  }

  async function handleAnalyze() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/analyze`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "分析失败"); }
      toast.success("分析报告已生成");
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "分析失败"); }
    finally { setAnalyzing(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("项目已删除");
      router.push("/projects");
    } catch { toast.error("删除失败"); setDeleting(false); setConfirmDelete(false); }
  }

  const cp = project.contentPlan;
  const vj = project.videoJob;
  const angles = (cp?.contentAngles ?? []) as ContentAngle[];
  const canEdit = cp && ["CONTENT_GENERATED", "VIDEO_FAILED"].includes(project.status);

  const hasTwoSegments = !!(vj?.videoUrl && vj?.videoUrl2);
  const persistedStitchedUrl = vj?.stitchedVideoUrl ?? null;
  const effectiveStitchedUrl = persistedStitchedUrl || stitchedUrl;

  useEffect(() => {
    if (!hasTwoSegments) return;
    if (persistedStitchedUrl) return;
    if (!isAdmin) return;
    if (stitchedUrl || stitching || stitchAttempted.current) return;

    stitchAttempted.current = true;
    (async () => {
      setStitching(true);
      setStitchProgress(0);
      try {
        const { stitchVideos } = await import("@/lib/video-stitcher");
        const { objectUrl, blob } = await stitchVideos(
          vj!.videoUrl!,
          vj!.videoUrl2!,
          setStitchProgress,
        );
        setStitchedUrl(objectUrl);

        try {
          const fd = new FormData();
          fd.append(
            "file",
            new File([blob], `stitched-${project.id}.mp4`, { type: "video/mp4" }),
          );
          const res = await fetch(`/api/projects/${project.id}/stitch`, {
            method: "POST",
            body: fd,
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.stitchedVideoUrl) {
              setProject((p) =>
                p.videoJob
                  ? {
                      ...p,
                      videoJob: { ...p.videoJob, stitchedVideoUrl: data.stitchedVideoUrl },
                    }
                  : p,
              );
            }
            toast.success("视频拼接完成并已保存");
          } else {
            console.warn("[stitch] persist failed:", await res.text());
            toast.success("视频拼接完成（未保存，刷新后需重新拼接）");
          }
        } catch (persistErr) {
          console.warn("[stitch] persist error:", persistErr);
          toast.success("视频拼接完成（未保存）");
        }
      } catch (e) {
        console.error("Stitch failed:", e);
        toast.error("视频拼接失败，可分段查看");
      } finally {
        setStitching(false);
      }
    })();
  }, [
    hasTwoSegments,
    persistedStitchedUrl,
    isAdmin,
    stitchedUrl,
    stitching,
    vj,
    project.id,
  ]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium">
            作品详情
          </p>
          <StatusBadge status={project.status} />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {project.keyword}
            </h1>
            {project.product && (
              <p className="text-xs text-violet-400/80 mt-0.5">
                {project.product.name}
              </p>
            )}
            {project.trendRef && (
              <p className="text-xs text-amber-400/80 mt-0.5">
                灵感参考：{project.trendRef.title?.slice(0, 40) || "爆款视频参考"}
                {project.trendRef.authorName && ` · @${project.trendRef.authorName}`}
              </p>
            )}
            <p className="text-xs text-zinc-400 mt-1">
              {formatDate(project.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isAdmin && <ActionButtons
              project={project}
              generating={generating}
              videoSubmitting={videoSubmitting}
              publishing={publishing}
              analyzing={analyzing}
              deleting={deleting}
              confirmPublish={confirmPublish}
              confirmDelete={confirmDelete}
              selectedDuration={selectedDuration}
              onGenerate={handleGenerate}
              onVideoGenerate={handleVideoGenerate}
              onPublish={handlePublish}
              onAnalyze={handleAnalyze}
              onDelete={handleDelete}
              onConfirmPublish={setConfirmPublish}
              onConfirmDelete={setConfirmDelete}
              onDurationChange={setSelectedDuration}
            />}
            {!isAdmin && (
              <span className="text-xs text-zinc-500 rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-1.5">
                浏览模式 · 生成功能需要管理员权限
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stepper */}
      <StatusStepper status={project.status} />

      {/* Error */}
      {project.errorMessage && (
        <div className="flex items-start gap-3 rounded-xl bg-red-500/10 p-4">
          <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-400">{project.errorMessage}</p>
        </div>
      )}

      {/* DRAFT empty state */}
      {project.status === "DRAFT" && !cp && (
        <div className="text-center py-16">
          <Sparkles className="h-8 w-8 text-zinc-500 mx-auto mb-4" />
          <p className="text-sm text-zinc-400">
            点击「生成内容」，AI 将为「{project.keyword}」创建完整的内容方案
          </p>
        </div>
      )}

      {/* Video generating */}
      {isVideoGenerating && (
        <div className="rounded-xl bg-amber-500/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            <span className="text-sm font-medium text-amber-400">
              视频生成中 {videoProgress > 0 ? `${videoProgress}%` : ""}
            </span>
          </div>
          <div className="h-1 w-full bg-amber-500/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${videoProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Video failed */}
      {project.status === "VIDEO_FAILED" && vj && (
        <div className="rounded-xl border border-zinc-800 p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <span className="text-sm font-medium text-red-400">视频生成失败</span>
          </div>
          <p className="text-xs text-red-400 mb-1">{vj.errorMessage || "未知错误"}</p>
          <p className="text-[11px] text-zinc-400">已重试 {vj.retryCount} 次</p>
        </div>
      )}

      {/* Publishing */}
      {project.status === "PUBLISHING" && (
        <div className="flex items-center gap-3 rounded-xl bg-violet-500/10 p-5">
          <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
          <span className="text-sm text-violet-400">正在发布到 TikTok...</span>
        </div>
      )}

      {/* Uploaded Product Images */}
      {project.imageUrls && project.imageUrls.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-3">
            产品图参考 · {project.imageUrls.length} 张
          </p>
          <div className="flex gap-2 flex-wrap">
            {project.imageUrls.map((url: string, i: number) => (
              <div
                key={i}
                className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                  url === project.primaryImageUrl
                    ? "border-violet-500 ring-2 ring-violet-500/20"
                    : "border-zinc-700"
                }`}
              >
                <img src={url} alt={`产品图 ${i + 1}`} className="w-16 h-16 object-cover" />
                {url === project.primaryImageUrl && (
                  <div className="absolute top-0.5 left-0.5 rounded-full bg-violet-500 px-1 py-0.5">
                    <span className="text-[7px] font-bold text-white">主图</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content area */}
      {(vj?.status === "COMPLETED" && vj.videoUrl) || cp ? (
        <div className="grid gap-8 lg:grid-cols-5">
          {/* Left: Video */}
          {vj?.status === "COMPLETED" && vj.videoUrl && (
            <div className="lg:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-3">
                视频预览 {vj.videoUrl2 ? `· ${vj.duration}s` : ""}
              </p>

              {/* Stitching progress */}
              {stitching && (
                <div className="rounded-xl bg-violet-500/10 p-4 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Scissors className="h-3.5 w-3.5 text-violet-400" />
                    <span className="text-xs font-medium text-violet-400">
                      视频拼接中 {stitchProgress}%
                    </span>
                  </div>
                  <div className="h-1 w-full bg-violet-500/20 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-300" style={{ width: `${stitchProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Stitched 30s video (persisted or just produced) */}
              {effectiveStitchedUrl ? (
                <div className="rounded-2xl overflow-hidden bg-zinc-950 shadow-none">
                  <div className="aspect-[9/16]">
                    <video src={effectiveStitchedUrl} controls className="w-full h-full object-contain" />
                  </div>
                </div>
              ) : hasTwoSegments && !isAdmin ? (
                <div className="rounded-2xl overflow-hidden bg-zinc-950 shadow-none">
                  <div className="aspect-[9/16]">
                    <video src={vj.videoUrl} controls className="w-full h-full object-contain" poster={vj.thumbnailUrl || undefined} />
                  </div>
                  <div className="px-3 py-2 text-[11px] text-zinc-500">
                    30 秒完整版尚未由管理员拼接保存，当前显示前 15 秒
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl overflow-hidden bg-zinc-950 shadow-none">
                  <div className="aspect-[9/16]">
                    <video src={vj.videoUrl} controls className="w-full h-full object-contain" poster={vj.thumbnailUrl || undefined} />
                  </div>
                </div>
              )}

              {/* Download + segment info */}
              <div className="flex items-center justify-between mt-3 text-[11px] text-zinc-300">
                <span>{vj.provider}</span>
                <div className="flex items-center gap-3">
                  {effectiveStitchedUrl && (
                    <a href={effectiveStitchedUrl} download={`${project.keyword}-30s.mp4`} className="flex items-center gap-1 text-violet-400 hover:text-violet-300">
                      <Download className="h-3 w-3" /> 下载 30s
                    </a>
                  )}
                  {vj.completedAt && <span>{formatDate(vj.completedAt)}</span>}
                </div>
              </div>

              {/* Show both segments if stitched */}
              {vj.videoUrl2 && effectiveStitchedUrl && (
                <details className="mt-3">
                  <summary className="text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-400">
                    查看分段视频
                  </summary>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <p className="text-[10px] text-zinc-500 mb-1">Part 1</p>
                      <video src={vj.videoUrl} controls className="w-full rounded-lg" />
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 mb-1">Part 2</p>
                      <video src={vj.videoUrl2} controls className="w-full rounded-lg" />
                    </div>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Right: Content */}
          {cp && (
            <div className={cn(
              "space-y-6",
              vj?.status === "COMPLETED" && vj.videoUrl ? "lg:col-span-3" : "lg:col-span-5"
            )}>
              {/* Edit toggle */}
              {canEdit && (
                <div className="flex justify-end">
                  {!editing ? (
                    <button onClick={startEditing} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors">
                      <Pencil className="h-3 w-3" />
                      编辑
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={handleSaveEdit} disabled={saving} className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50">
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        保存
                      </button>
                      <button onClick={() => setEditing(false)} disabled={saving} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 disabled:opacity-50">
                        <X className="h-3 w-3" />
                        取消
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Script */}
              <ContentSection label="视频脚本">
                {editing ? (
                  <Textarea
                    value={editData.script}
                    onChange={(e) => setEditData((d) => ({ ...d, script: e.target.value }))}
                    rows={6}
                    className="text-sm border-zinc-700 bg-zinc-900 focus:border-violet-500 focus:ring-violet-500/20"
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-zinc-400 whitespace-pre-wrap">{cp.script}</p>
                )}
              </ContentSection>

              {/* Caption */}
              <ContentSection label="TikTok 标题">
                {editing ? (
                  <Input
                    value={editData.caption}
                    onChange={(e) => setEditData((d) => ({ ...d, caption: e.target.value }))}
                    className="text-sm border-zinc-700 bg-zinc-900 focus:border-violet-500 focus:ring-violet-500/20"
                  />
                ) : (
                  <p className="text-sm text-zinc-100">{cp.caption}</p>
                )}
              </ContentSection>

              {/* Hashtags */}
              <ContentSection label="Hashtags">
                <div className="flex flex-wrap gap-1.5">
                  {cp.hashtags.map((tag, i) => (
                    <span key={i} className="rounded-full bg-zinc-800/50 px-2.5 py-0.5 text-[11px] text-zinc-400">
                      {tag.startsWith("#") ? tag : `#${tag}`}
                    </span>
                  ))}
                </div>
              </ContentSection>

              {/* Video prompt */}
              <ContentSection label="视频提示词">
                {editing ? (
                  <Textarea
                    value={editData.videoPrompt}
                    onChange={(e) => setEditData((d) => ({ ...d, videoPrompt: e.target.value }))}
                    rows={3}
                    className="text-sm border-zinc-700 bg-zinc-900 focus:border-violet-500 focus:ring-violet-500/20"
                  />
                ) : (
                  <p className="text-sm text-zinc-400 italic">{cp.videoPrompt}</p>
                )}
              </ContentSection>

              {/* Angles */}
              {angles.length > 0 && (
                <ContentSection label="内容角度">
                  <div className="space-y-3">
                    {angles.map((a, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium text-zinc-100">{a.angle}</p>
                        <p className="text-xs text-zinc-400 mt-0.5">{a.reason}</p>
                      </div>
                    ))}
                  </div>
                </ContentSection>
              )}

              {/* Meta */}
              <div className="flex items-center gap-4 text-[11px] text-zinc-300 pt-2">
                <span>模型 {cp.modelUsed}</span>
                <span>{formatDate(cp.createdAt)}</span>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Published + Analytics section */}
      {project.publication?.publishStatus === "PUBLISHED" && (
        <div className="space-y-6">
          {/* TikTok publish confirmation */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">已发布到 TikTok</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {project.publication.publishedAt && formatDate(project.publication.publishedAt)}
                  </p>
                </div>
              </div>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-zinc-800/50 text-zinc-300 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50"
                onClick={handleAnalyze}
                disabled={analyzing}
              >
                {analyzing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {project.analysisReport ? "刷新分析" : "获取分析"}
              </button>
            </div>

            {/* Metrics cards */}
            {project.publication.snapshots?.[0] ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "播放量", value: project.publication.snapshots[0].views, icon: Play, color: "text-sky-400" },
                  { label: "点赞数", value: project.publication.snapshots[0].likes, icon: Heart, color: "text-pink-400" },
                  { label: "评论数", value: project.publication.snapshots[0].comments, icon: MessageCircle, color: "text-amber-400" },
                  { label: "分享数", value: project.publication.snapshots[0].shares, icon: Share2, color: "text-emerald-400" },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <m.icon className={cn("h-3.5 w-3.5", m.color)} />
                      <span className="text-[11px] text-zinc-500">{m.label}</span>
                    </div>
                    <p className="text-xl font-light tabular-nums text-white">
                      {m.value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-xs text-zinc-500">暂无数据，点击「获取分析」拉取 TikTok 数据</p>
              </div>
            )}
            {project.publication.snapshots?.[0] && (
              <p className="text-[10px] text-zinc-600 mt-3">
                数据更新于 {formatDate(project.publication.snapshots[0].fetchedAt)}
              </p>
            )}
          </div>

          {/* AI Analysis report */}
          {project.analysisReport && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                    <BarChart3 className="h-4 w-4 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">AI 数据分析</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {project.analysisReport.modelUsed} · {formatDate(project.analysisReport.createdAt)}
                    </p>
                  </div>
                </div>
                {project.analysisReport.overallScore !== null && (
                  <div className="text-right">
                    <div className="flex items-baseline gap-0.5">
                      <span className={cn(
                        "text-3xl font-light tabular-nums",
                        project.analysisReport.overallScore >= 70 ? "text-emerald-400" :
                        project.analysisReport.overallScore >= 40 ? "text-amber-400" : "text-red-400"
                      )}>
                        {project.analysisReport.overallScore}
                      </span>
                      <span className="text-xs text-zinc-500">/100</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-0.5">综合评分</p>
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <AnalysisBlock label="表现总结" content={project.analysisReport.performanceSummary} />
                <AnalysisBlock label="方向建议" content={project.analysisReport.directionAdvice} />
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-3">
                    优化建议
                  </p>
                  <div className="space-y-2">
                    {project.analysisReport.optimizationTips.map((tip, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <span className="shrink-0 h-5 w-5 rounded-md bg-violet-500/10 flex items-center justify-center text-[10px] text-violet-400 font-medium mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-sm text-zinc-400 leading-relaxed">{tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContentSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-2">
        {label}
      </p>
      {children}
    </div>
  );
}

function AnalysisBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-1.5">
        {label}
      </p>
      <p className="text-sm leading-relaxed text-zinc-400">{content}</p>
    </div>
  );
}

function ActionButtons({
  project,
  generating, videoSubmitting, publishing, analyzing, deleting,
  confirmPublish, confirmDelete, selectedDuration,
  onGenerate, onVideoGenerate, onPublish, onAnalyze, onDelete,
  onConfirmPublish, onConfirmDelete, onDurationChange,
}: {
  project: ProjectWithRelations;
  generating: boolean; videoSubmitting: boolean; publishing: boolean; analyzing: boolean; deleting: boolean;
  confirmPublish: boolean; confirmDelete: boolean; selectedDuration: number;
  onGenerate: () => void; onVideoGenerate: () => void; onPublish: () => void; onAnalyze: () => void; onDelete: () => void;
  onConfirmPublish: (v: boolean) => void; onConfirmDelete: (v: boolean) => void; onDurationChange: (v: number) => void;
}) {
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const primary = `${btn} bg-violet-600 text-white hover:bg-violet-700`;
  const secondary = `${btn} bg-zinc-800/50 text-zinc-100 hover:bg-white/5`;
  const ghost = `${btn} text-zinc-400 hover:text-zinc-300 hover:bg-white/5`;
  const destructive = `${btn} bg-red-600 text-white hover:bg-red-700`;

  return (
    <>
      {(project.status === "DRAFT" || project.status === "CONTENT_GENERATED") && (
        <button className={primary} onClick={onGenerate} disabled={generating}>
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {project.status === "DRAFT" ? "生成内容" : "重新生成"}
        </button>
      )}
      {(project.status === "CONTENT_GENERATED" || project.status === "VIDEO_FAILED") && (
        <div className="flex items-center gap-1.5">
          <select
            value={selectedDuration}
            onChange={(e) => onDurationChange(Number(e.target.value))}
            className="rounded-lg bg-zinc-800/50 border border-zinc-700 text-zinc-100 text-sm px-2 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            <option value={15}>15秒</option>
            <option value={30}>30秒</option>
          </select>
          <button className={secondary} onClick={onVideoGenerate} disabled={videoSubmitting}>
            {videoSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
            生成视频
          </button>
        </div>
      )}
      {(project.status === "VIDEO_READY" || project.status === "PUBLISH_FAILED") && (
        !confirmPublish ? (
          <button className={secondary} onClick={() => onConfirmPublish(true)}>
            <Send className="h-3.5 w-3.5" />
            发布到 TikTok
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button className={primary} onClick={onPublish} disabled={publishing}>
              {publishing && <Loader2 className="h-3 w-3 animate-spin" />}
              确认发布
            </button>
            <button className={ghost} onClick={() => onConfirmPublish(false)} disabled={publishing}>
              取消
            </button>
          </div>
        )
      )}
      {["PUBLISHED", "ANALYTICS_FETCHED", "ANALYTICS_PENDING", "ANALYZED"].includes(project.status) && (
        <button className={secondary} onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
          {project.status === "ANALYZED" ? "重新分析" : "分析数据"}
        </button>
      )}
      {!confirmDelete ? (
        <button className={`${ghost} text-red-400 hover:text-red-300 hover:bg-red-500/10`} onClick={() => onConfirmDelete(true)}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <button className={destructive} onClick={onDelete} disabled={deleting}>
            {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
            确认删除
          </button>
          <button className={ghost} onClick={() => onConfirmDelete(false)} disabled={deleting}>
            取消
          </button>
        </div>
      )}
    </>
  );
}
