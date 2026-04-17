"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles,
  Video,
  Trash2,
  Loader2,
  AlertCircle,
  Pencil,
  Save,
  X,
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
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ script: "", caption: "", videoPrompt: "" });
  const [saving, setSaving] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(15);
  const [stitching, setStitching] = useState(false);
  const [stitchProgress, setStitchProgress] = useState(0);
  const [stitchedUrl, setStitchedUrl] = useState<string | null>(null);
  const [stitchFailed, setStitchFailed] = useState(false);
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

  async function handleAutoGenerate() {
    if (generating || videoSubmitting) return;
    setGenerating(true);
    setVideoSubmitting(true);
    try {
      toast.info("一键生成启动：正在生成文案 + 视频");
      const res = await fetch(`/api/projects/${project.id}/auto-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "pro",
          duration: selectedDuration,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "一键生成失败");
      }
      toast.success("已提交一键生成，正在合成视频...");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "一键生成失败");
    } finally {
      setGenerating(false);
      setVideoSubmitting(false);
    }
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

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("项目已删除");
      router.push("/projects");
    } catch { toast.error("删除失败"); setDeleting(false); setConfirmDelete(false); }
  }

  async function handleDownload(url: string, filename: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
    } catch {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank";
      a.click();
    }
  }

  const cp = project.contentPlan;
  const vj = project.videoJob;
  const angles = (cp?.contentAngles ?? []) as ContentAngle[];
  const canEdit = cp && ["CONTENT_GENERATED", "VIDEO_FAILED"].includes(project.status);

  const hasTwoSegments = !!(vj?.videoUrl && vj?.videoUrl2);
  const persistedStitchedUrl = vj?.stitchedVideoUrl ?? null;
  const effectiveStitchedUrl = persistedStitchedUrl || stitchedUrl;
  const mainDownloadUrl = effectiveStitchedUrl || vj?.videoUrl || null;

  const isBlobUrl = (u: string | null | undefined) =>
    !!u && (u.includes(".public.blob.vercel-storage.com") || u.includes(".blob.vercel-storage.com"));
  const needsMigrate = !!vj && (
    (!!vj.videoUrl && !isBlobUrl(vj.videoUrl)) ||
    (!!vj.videoUrl2 && !isBlobUrl(vj.videoUrl2))
  );
  const [migrating, setMigrating] = useState(false);

  async function handleRepersist() {
    setMigrating(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/repersist`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "迁移失败");
      if (data.errors?.length) {
        toast.warning(`部分失败：${data.errors.join("; ")}`);
      } else {
        toast.success("视频已迁移到永久存储");
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "迁移失败");
    } finally {
      setMigrating(false);
    }
  }

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
        setStitchFailed(true);
        toast.error("视频拼接失败，已为你显示分段");
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

  async function handleManualStitch() {
    if (!vj?.videoUrl || !vj.videoUrl2) return;
    stitchAttempted.current = false;
    setStitchFailed(false);
    setStitchedUrl(null);
    setStitching(true);
    setStitchProgress(0);
    try {
      const { stitchVideos } = await import("@/lib/video-stitcher");
      const { objectUrl, blob } = await stitchVideos(
        vj.videoUrl,
        vj.videoUrl2,
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
                ? { ...p, videoJob: { ...p.videoJob, stitchedVideoUrl: data.stitchedVideoUrl } }
                : p,
            );
          }
          toast.success("视频拼接完成并已保存");
        }
      } catch (e) {
        console.warn("[stitch] persist error:", e);
      }
    } catch (e) {
      console.error("Manual stitch failed:", e);
      setStitchFailed(true);
      toast.error("重新拼接失败");
    } finally {
      setStitching(false);
    }
  }

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
              <p className="text-xs text-teal-400/80 mt-0.5">
                {project.product.name}
              </p>
            )}
            <p className="text-xs text-zinc-400 mt-1">
              {formatDate(project.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {mainDownloadUrl && (
              <button
                onClick={() => handleDownload(mainDownloadUrl, `${project.keyword}-${vj?.duration || 15}s.mp4`)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                下载视频
              </button>
            )}
            {isAdmin && <ActionButtons
              project={project}
              generating={generating}
              videoSubmitting={videoSubmitting}
              deleting={deleting}
              confirmDelete={confirmDelete}
              selectedDuration={selectedDuration}
              onGenerate={handleGenerate}
              onAutoGenerate={handleAutoGenerate}
              onVideoGenerate={handleVideoGenerate}
              onDelete={handleDelete}
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
                    ? "border-teal-500 ring-2 ring-teal-500/20"
                    : "border-zinc-700"
                }`}
              >
                <img src={url} alt={`产品图 ${i + 1}`} className="w-16 h-16 object-cover" />
                {url === project.primaryImageUrl && (
                  <div className="absolute top-0.5 left-0.5 rounded-full bg-teal-500 px-1 py-0.5">
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
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium">
                  视频预览 {vj.videoUrl2 ? `· ${vj.duration}s` : ""}
                </p>
                {isAdmin && needsMigrate && (
                  <button
                    onClick={handleRepersist}
                    disabled={migrating}
                    className="text-[11px] text-teal-400 hover:text-teal-300 disabled:opacity-50 underline underline-offset-2"
                    title="将视频从临时 URL 迁移到 Vercel Blob 永久存储"
                  >
                    {migrating ? "迁移中..." : "迁移到永久存储"}
                  </button>
                )}
              </div>

              {/* Stitching progress */}
              {stitching && (
                <div className="rounded-xl bg-teal-500/10 p-4 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Scissors className="h-3.5 w-3.5 text-teal-400" />
                    <span className="text-xs font-medium text-teal-400">
                      视频拼接中 {stitchProgress}%
                    </span>
                  </div>
                  <div className="h-1 w-full bg-teal-500/20 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: `${stitchProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Preview area with fallback chain */}
              {effectiveStitchedUrl ? (
                <div className="rounded-2xl overflow-hidden bg-zinc-950 shadow-none">
                  <div className="aspect-[9/16]">
                    <video
                      src={effectiveStitchedUrl}
                      controls
                      className="w-full h-full object-contain"
                      onError={() => {
                        if (hasTwoSegments) setStitchFailed(true);
                      }}
                    />
                  </div>
                </div>
              ) : hasTwoSegments ? (
                <div className="space-y-2">
                  {stitchFailed && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-300 flex items-center justify-between gap-2">
                      <span>30 秒拼接失败，下方显示两个分段</span>
                      {isAdmin && !stitching && (
                        <button
                          onClick={handleManualStitch}
                          className="text-amber-200 hover:text-amber-100 underline underline-offset-2"
                        >
                          重新拼接
                        </button>
                      )}
                    </div>
                  )}
                  {!stitchFailed && !isAdmin && (
                    <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-2 text-[11px] text-zinc-400">
                      30 秒完整版尚未由管理员拼接保存，下方可分段观看
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl overflow-hidden bg-zinc-950">
                      <p className="px-2 py-1 text-[10px] text-zinc-500 bg-zinc-900/50">Part 1 · 15s</p>
                      <video src={vj.videoUrl} controls className="w-full aspect-[9/16] object-contain" poster={vj.thumbnailUrl || undefined} />
                    </div>
                    <div className="rounded-xl overflow-hidden bg-zinc-950">
                      <p className="px-2 py-1 text-[10px] text-zinc-500 bg-zinc-900/50">Part 2 · 15s</p>
                      <video src={vj.videoUrl2!} controls className="w-full aspect-[9/16] object-contain" />
                    </div>
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
                    <button
                      onClick={() => handleDownload(effectiveStitchedUrl, `${project.keyword}-30s.mp4`)}
                      className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                    >
                      <Download className="h-3 w-3" /> 下载 30s
                    </button>
                  )}
                  {vj.videoUrl && !effectiveStitchedUrl && (
                    <button
                      onClick={() => handleDownload(vj.videoUrl!, `${project.keyword}-15s.mp4`)}
                      className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                    >
                      <Download className="h-3 w-3" /> 下载
                    </button>
                  )}
                  {vj.completedAt && <span>{formatDate(vj.completedAt)}</span>}
                </div>
              </div>

              {/* Segments details when stitched */}
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
                      <button onClick={handleSaveEdit} disabled={saving} className="flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50">
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
                    className="text-sm border-zinc-700 bg-zinc-900 focus:border-teal-500 focus:ring-teal-500/20"
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-zinc-400 whitespace-pre-wrap">{cp.script}</p>
                )}
              </ContentSection>

              {/* Caption */}
              <ContentSection label="视频标题">
                {editing ? (
                  <Input
                    value={editData.caption}
                    onChange={(e) => setEditData((d) => ({ ...d, caption: e.target.value }))}
                    className="text-sm border-zinc-700 bg-zinc-900 focus:border-teal-500 focus:ring-teal-500/20"
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
                    className="text-sm border-zinc-700 bg-zinc-900 focus:border-teal-500 focus:ring-teal-500/20"
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

function ActionButtons({
  project,
  generating, videoSubmitting, deleting,
  confirmDelete, selectedDuration,
  onGenerate, onAutoGenerate, onVideoGenerate, onDelete,
  onConfirmDelete, onDurationChange,
}: {
  project: ProjectWithRelations;
  generating: boolean; videoSubmitting: boolean; deleting: boolean;
  confirmDelete: boolean; selectedDuration: number;
  onGenerate: () => void; onAutoGenerate: () => void; onVideoGenerate: () => void; onDelete: () => void;
  onConfirmDelete: (v: boolean) => void; onDurationChange: (v: number) => void;
}) {
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const primary = `${btn} bg-primary text-primary-foreground hover:opacity-90`;
  const secondary = `${btn} bg-zinc-800/50 text-zinc-100 hover:bg-white/5`;
  const ghost = `${btn} text-zinc-400 hover:text-zinc-300 hover:bg-white/5`;
  const destructive = `${btn} bg-destructive text-white hover:opacity-90`;

  return (
    <>
      {project.status === "DRAFT" && (
        <>
          <button className={primary} onClick={onAutoGenerate} disabled={generating || videoSubmitting}>
            {(generating || videoSubmitting) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            一键生成
          </button>
          <button className={ghost} onClick={onGenerate} disabled={generating}>
            仅生成文案
          </button>
        </>
      )}
      {project.status === "CONTENT_GENERATED" && (
        <button className={ghost} onClick={onGenerate} disabled={generating}>
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          重新生成文案
        </button>
      )}
      {(project.status === "CONTENT_GENERATED" || project.status === "VIDEO_FAILED") && (
        <div className="flex items-center gap-1.5">
          <select
            value={selectedDuration}
            onChange={(e) => onDurationChange(Number(e.target.value))}
            className="rounded-lg bg-zinc-800/50 border border-zinc-700 text-zinc-100 text-sm px-2 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
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
