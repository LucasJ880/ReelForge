"use client";

import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { StatusStepper } from "@/components/project/status-stepper";
import { StatusBadge } from "@/components/project/status-badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ProjectWithRelations, ContentAngle } from "@/types";

export function ProjectDetailClient({
  project: initial,
}: {
  project: ProjectWithRelations;
}) {
  const router = useRouter();
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
    try {
      const res = await fetch(`/api/projects/${project.id}/video`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "视频生成失败"); }
      toast.info("视频生成已提交");
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
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              {project.keyword}
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              {formatDate(project.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ActionButtons
              project={project}
              generating={generating}
              videoSubmitting={videoSubmitting}
              publishing={publishing}
              analyzing={analyzing}
              deleting={deleting}
              confirmPublish={confirmPublish}
              confirmDelete={confirmDelete}
              onGenerate={handleGenerate}
              onVideoGenerate={handleVideoGenerate}
              onPublish={handlePublish}
              onAnalyze={handleAnalyze}
              onDelete={handleDelete}
              onConfirmPublish={setConfirmPublish}
              onConfirmDelete={setConfirmDelete}
            />
          </div>
        </div>
      </div>

      {/* Stepper */}
      <StatusStepper status={project.status} />

      {/* Error */}
      {project.errorMessage && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-600">{project.errorMessage}</p>
        </div>
      )}

      {/* DRAFT empty state */}
      {project.status === "DRAFT" && !cp && (
        <div className="text-center py-16">
          <Sparkles className="h-8 w-8 text-zinc-200 mx-auto mb-4" />
          <p className="text-sm text-zinc-400">
            点击「生成内容」，AI 将为「{project.keyword}」创建完整的内容方案
          </p>
        </div>
      )}

      {/* Video generating */}
      {isVideoGenerating && (
        <div className="rounded-xl bg-amber-50 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
            <span className="text-sm font-medium text-amber-700">
              视频生成中 {videoProgress > 0 ? `${videoProgress}%` : ""}
            </span>
          </div>
          <div className="h-1 w-full bg-amber-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${videoProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Video failed */}
      {project.status === "VIDEO_FAILED" && vj && (
        <div className="rounded-xl border border-red-100 p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium text-red-600">视频生成失败</span>
          </div>
          <p className="text-xs text-red-500 mb-1">{vj.errorMessage || "未知错误"}</p>
          <p className="text-[11px] text-zinc-400">已重试 {vj.retryCount} 次</p>
        </div>
      )}

      {/* Publishing */}
      {project.status === "PUBLISHING" && (
        <div className="flex items-center gap-3 rounded-xl bg-violet-50 p-5">
          <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
          <span className="text-sm text-violet-600">正在发布到 TikTok...</span>
        </div>
      )}

      {/* Main content area */}
      {(vj?.status === "COMPLETED" && vj.videoUrl) || cp ? (
        <div className="grid gap-8 lg:grid-cols-5">
          {/* Left: Video */}
          {vj?.status === "COMPLETED" && vj.videoUrl && (
            <div className="lg:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-3">
                视频预览
              </p>
              <div className="rounded-2xl overflow-hidden bg-zinc-950 shadow-lg">
                <div className="aspect-[9/16]">
                  <video
                    src={vj.videoUrl}
                    controls
                    className="w-full h-full object-contain"
                    poster={vj.thumbnailUrl || undefined}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 text-[11px] text-zinc-300">
                <span>{vj.provider}</span>
                {vj.completedAt && <span>{formatDate(vj.completedAt)}</span>}
              </div>
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
                    <button onClick={startEditing} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
                      <Pencil className="h-3 w-3" />
                      编辑
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={handleSaveEdit} disabled={saving} className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700 disabled:opacity-50">
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        保存
                      </button>
                      <button onClick={() => setEditing(false)} disabled={saving} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-50">
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
                    className="text-sm border-zinc-200 focus:border-violet-300 focus:ring-violet-100"
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-zinc-600 whitespace-pre-wrap">{cp.script}</p>
                )}
              </ContentSection>

              {/* Caption */}
              <ContentSection label="TikTok 标题">
                {editing ? (
                  <Input
                    value={editData.caption}
                    onChange={(e) => setEditData((d) => ({ ...d, caption: e.target.value }))}
                    className="text-sm border-zinc-200 focus:border-violet-300 focus:ring-violet-100"
                  />
                ) : (
                  <p className="text-sm text-zinc-700">{cp.caption}</p>
                )}
              </ContentSection>

              {/* Hashtags */}
              <ContentSection label="Hashtags">
                <div className="flex flex-wrap gap-1.5">
                  {cp.hashtags.map((tag, i) => (
                    <span key={i} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] text-zinc-600">
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
                    className="text-sm border-zinc-200 focus:border-violet-300 focus:ring-violet-100"
                  />
                ) : (
                  <p className="text-sm text-zinc-500 italic">{cp.videoPrompt}</p>
                )}
              </ContentSection>

              {/* Angles */}
              {angles.length > 0 && (
                <ContentSection label="内容角度">
                  <div className="space-y-3">
                    {angles.map((a, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium text-zinc-700">{a.angle}</p>
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

      {/* Published stats */}
      {project.publication?.publishStatus === "PUBLISHED" && (
        <div className="rounded-xl bg-emerald-50 p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">已发布到 TikTok</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-emerald-600 mb-4">
            <span>ID: {project.publication.platformVideoId || "N/A"}</span>
            {project.publication.publishedAt && (
              <span>{formatDate(project.publication.publishedAt)}</span>
            )}
          </div>
          {project.publication.snapshots?.[0] && (
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "播放", value: project.publication.snapshots[0].views },
                { label: "点赞", value: project.publication.snapshots[0].likes },
                { label: "评论", value: project.publication.snapshots[0].comments },
                { label: "分享", value: project.publication.snapshots[0].shares },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-xl font-extralight tabular-nums text-emerald-800">
                    {m.value.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-emerald-500">{m.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Analysis report */}
      {project.analysisReport && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium">
              数据分析
            </p>
            {project.analysisReport.overallScore !== null && (
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-extralight tabular-nums text-zinc-900">
                  {project.analysisReport.overallScore}
                </span>
                <span className="text-xs text-zinc-300">/ 100</span>
              </div>
            )}
          </div>
          <div className="space-y-5">
            <AnalysisBlock label="表现总结" content={project.analysisReport.performanceSummary} />
            <AnalysisBlock label="方向建议" content={project.analysisReport.directionAdvice} />
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-2">
                优化建议
              </p>
              <ul className="space-y-2">
                {project.analysisReport.optimizationTips.map((tip, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-zinc-600">
                    <span className="text-zinc-300 shrink-0 tabular-nums text-xs mt-0.5">{i + 1}.</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
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
      <p className="text-sm leading-relaxed text-zinc-600">{content}</p>
    </div>
  );
}

function ActionButtons({
  project,
  generating, videoSubmitting, publishing, analyzing, deleting,
  confirmPublish, confirmDelete,
  onGenerate, onVideoGenerate, onPublish, onAnalyze, onDelete,
  onConfirmPublish, onConfirmDelete,
}: {
  project: ProjectWithRelations;
  generating: boolean; videoSubmitting: boolean; publishing: boolean; analyzing: boolean; deleting: boolean;
  confirmPublish: boolean; confirmDelete: boolean;
  onGenerate: () => void; onVideoGenerate: () => void; onPublish: () => void; onAnalyze: () => void; onDelete: () => void;
  onConfirmPublish: (v: boolean) => void; onConfirmDelete: (v: boolean) => void;
}) {
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const primary = `${btn} bg-violet-600 text-white hover:bg-violet-700`;
  const secondary = `${btn} bg-zinc-100 text-zinc-700 hover:bg-zinc-200`;
  const ghost = `${btn} text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100`;
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
        <button className={secondary} onClick={onVideoGenerate} disabled={videoSubmitting}>
          {videoSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
          生成视频
        </button>
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
        <button className={`${ghost} text-red-400 hover:text-red-600 hover:bg-red-50`} onClick={() => onConfirmDelete(true)}>
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
