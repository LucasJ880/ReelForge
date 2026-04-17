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
import { FreeChannelPanel } from "@/components/project/free-channel-panel";
import {
  FreeChannelOptions,
  DEFAULT_FREE_OPTIONS,
  type FreeChannelOptionsValue,
} from "@/components/project/free-channel-options";
import { UserAssetsManager } from "@/components/project/user-assets-manager";
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
  const [freeOptions, setFreeOptions] =
    useState<FreeChannelOptionsValue>(DEFAULT_FREE_OPTIONS);
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

  async function handleFreeGenerate() {
    if (generating || videoSubmitting) return;
    setGenerating(true);
    setVideoSubmitting(true);
    try {
      toast.info("Free 通道：正在准备素材（Pexels + Edge TTS）...");
      const res = await fetch(`/api/projects/${project.id}/free-prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceId: freeOptions.voiceId,
          rate: freeOptions.rate,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Free 通道准备失败");
      }
      toast.success("素材就绪，即将在浏览器里合成视频");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Free 通道失败");
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
          <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium">
            作品详情
          </p>
          <StatusBadge status={project.status} />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {project.keyword}
            </h1>
            {project.brandDescription && (
              <p className="text-xs text-primary/80 mt-0.5 line-clamp-1 max-w-lg">
                {project.brandDescription}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
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
              onFreeGenerate={handleFreeGenerate}
              onVideoGenerate={handleVideoGenerate}
              onDelete={handleDelete}
              onConfirmDelete={setConfirmDelete}
              onDurationChange={setSelectedDuration}
            />}
            {!isAdmin && (
              <span className="text-xs text-muted-foreground rounded-lg bg-card/70 border border-border px-3 py-1.5">
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
        <div className="space-y-4">
          <div className="text-center py-10 rounded-xl border border-dashed border-border bg-card/40">
            <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              点击顶部按钮开始，AI 将为「<span className="text-foreground">{project.keyword}</span>」生成完整的文案 + 视频
            </p>
          </div>
          {isAdmin && (
            <>
              <FreeChannelOptions value={freeOptions} onChange={setFreeOptions} />
              <UserAssetsManager
                projectId={project.id}
                initialAssets={project.userVideoAssets ?? []}
              />
            </>
          )}
        </div>
      )}

      {vj?.channel === "free" && vj.manifest ? (
        <FreeChannelPanel
          projectId={project.id}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          manifest={vj.manifest as any}
          currentVideoUrl={vj.status === "COMPLETED" ? vj.videoUrl : null}
        />
      ) : null}

      {/* Pro channel generating */}
      {isVideoGenerating && vj?.channel !== "free" && (
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
        <div className="rounded-xl border border-border p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <span className="text-sm font-medium text-red-400">视频生成失败</span>
          </div>
          <p className="text-xs text-red-400 mb-1">{vj.errorMessage || "未知错误"}</p>
          <p className="text-[11px] text-muted-foreground">已重试 {vj.retryCount} 次</p>
        </div>
      )}

      {/* Uploaded reference images */}
      {project.imageUrls && project.imageUrls.length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-3">
            参考图 · {project.imageUrls.length} 张
          </p>
          <div className="flex gap-2 flex-wrap">
            {project.imageUrls.map((url: string, i: number) => (
              <div
                key={i}
                className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                  url === project.primaryImageUrl
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border"
                }`}
              >
                <img src={url} alt={`参考图 ${i + 1}`} className="w-16 h-16 object-cover" />
                {url === project.primaryImageUrl && (
                  <div className="absolute top-0.5 left-0.5 rounded-full bg-primary px-1 py-0.5">
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
                <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium">
                  视频预览 {vj.videoUrl2 ? `· ${vj.duration}s` : ""}
                </p>
                {isAdmin && needsMigrate && (
                  <button
                    onClick={handleRepersist}
                    disabled={migrating}
                    className="text-[11px] text-primary hover:text-primary disabled:opacity-50 underline underline-offset-2"
                    title="将视频从临时 URL 迁移到 Vercel Blob 永久存储"
                  >
                    {migrating ? "迁移中..." : "迁移到永久存储"}
                  </button>
                )}
              </div>

              {/* Stitching progress */}
              {stitching && (
                <div className="rounded-xl bg-primary/10 p-4 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Scissors className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium text-primary">
                      视频拼接中 {stitchProgress}%
                    </span>
                  </div>
                  <div className="h-1 w-full bg-primary/20 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${stitchProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Preview area with fallback chain */}
              {effectiveStitchedUrl ? (
                <div className="rounded-2xl overflow-hidden bg-background shadow-none">
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
                    <div className="rounded-lg bg-card/80 border border-border px-3 py-2 text-[11px] text-muted-foreground">
                      30 秒完整版尚未由管理员拼接保存，下方可分段观看
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl overflow-hidden bg-background">
                      <p className="px-2 py-1 text-[10px] text-muted-foreground bg-card/60">Part 1 · 15s</p>
                      <video src={vj.videoUrl} controls className="w-full aspect-[9/16] object-contain" poster={vj.thumbnailUrl || undefined} />
                    </div>
                    <div className="rounded-xl overflow-hidden bg-background">
                      <p className="px-2 py-1 text-[10px] text-muted-foreground bg-card/60">Part 2 · 15s</p>
                      <video src={vj.videoUrl2!} controls className="w-full aspect-[9/16] object-contain" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl overflow-hidden bg-background shadow-none">
                  <div className="aspect-[9/16]">
                    <video src={vj.videoUrl} controls className="w-full h-full object-contain" poster={vj.thumbnailUrl || undefined} />
                  </div>
                </div>
              )}

              {/* Download + segment info */}
              <div className="flex items-center justify-between mt-3 text-[11px] text-foreground/90">
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
                  <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-muted-foreground">
                    查看分段视频
                  </summary>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">Part 1</p>
                      <video src={vj.videoUrl} controls className="w-full rounded-lg" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">Part 2</p>
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
                    <button onClick={startEditing} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground/90 transition-colors">
                      <Pencil className="h-3 w-3" />
                      编辑
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={handleSaveEdit} disabled={saving} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary disabled:opacity-50">
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        保存
                      </button>
                      <button onClick={() => setEditing(false)} disabled={saving} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground/90 disabled:opacity-50">
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
                    className="text-sm border-border bg-card focus:border-primary focus:ring-primary/20"
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{cp.script}</p>
                )}
              </ContentSection>

              {/* Caption */}
              <ContentSection label="视频标题">
                {editing ? (
                  <Input
                    value={editData.caption}
                    onChange={(e) => setEditData((d) => ({ ...d, caption: e.target.value }))}
                    className="text-sm border-border bg-card focus:border-primary focus:ring-primary/20"
                  />
                ) : (
                  <p className="text-sm text-foreground">{cp.caption}</p>
                )}
              </ContentSection>

              {/* Hashtags */}
              <ContentSection label="Hashtags">
                <div className="flex flex-wrap gap-1.5">
                  {cp.hashtags.map((tag, i) => (
                    <span key={i} className="rounded-full bg-accent/60 px-2.5 py-0.5 text-[11px] text-muted-foreground">
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
                    className="text-sm border-border bg-card focus:border-primary focus:ring-primary/20"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground italic">{cp.videoPrompt}</p>
                )}
              </ContentSection>

              {/* Angles */}
              {angles.length > 0 && (
                <ContentSection label="内容角度">
                  <div className="space-y-3">
                    {angles.map((a, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium text-foreground">{a.angle}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{a.reason}</p>
                      </div>
                    ))}
                  </div>
                </ContentSection>
              )}

              {/* Meta */}
              <div className="flex items-center gap-4 text-[11px] text-foreground/90 pt-2">
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
      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground font-medium mb-2">
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
  onGenerate, onAutoGenerate, onFreeGenerate, onVideoGenerate, onDelete,
  onConfirmDelete, onDurationChange,
}: {
  project: ProjectWithRelations;
  generating: boolean; videoSubmitting: boolean; deleting: boolean;
  confirmDelete: boolean; selectedDuration: number;
  onGenerate: () => void; onAutoGenerate: () => void; onFreeGenerate: () => void; onVideoGenerate: () => void; onDelete: () => void;
  onConfirmDelete: (v: boolean) => void; onDurationChange: (v: number) => void;
}) {
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const primary = `${btn} bg-primary text-primary-foreground hover:opacity-90`;
  const secondary = `${btn} bg-accent/60 text-foreground hover:bg-white/5`;
  const ghost = `${btn} text-muted-foreground hover:text-foreground/90 hover:bg-white/5`;
  const destructive = `${btn} bg-destructive text-white hover:opacity-90`;

  return (
    <>
      {project.status === "DRAFT" && (
        <>
          <button className={primary} onClick={onAutoGenerate} disabled={generating || videoSubmitting}>
            {(generating || videoSubmitting) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            一键生成 · Pro
          </button>
          <button className={secondary} onClick={onFreeGenerate} disabled={generating || videoSubmitting}>
            {(generating || videoSubmitting) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
            免费生成 · Free
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
            className="rounded-lg bg-accent/60 border border-border text-foreground text-sm px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
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
