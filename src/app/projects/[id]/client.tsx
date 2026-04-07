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
  Hash,
  FileText,
  Lightbulb,
  ImageIcon,
  Loader2,
  Play,
  AlertCircle,
  CheckCircle2,
  Pencil,
  Save,
  X,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { StatusStepper } from "@/components/project/status-stepper";
import { StatusBadge } from "@/components/project/status-badge";
import { formatDate } from "@/lib/utils";
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

  useEffect(() => {
    setProject(initial);
  }, [initial]);

  const isVideoGenerating = project.status === "VIDEO_GENERATING";

  const pollVideoStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/video`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.progress !== undefined) {
        setVideoProgress(data.progress);
      }

      if (data.status === "COMPLETED") {
        toast.success("视频生成完成");
        router.refresh();
      } else if (data.status === "FAILED") {
        toast.error("视频生成失败");
        router.refresh();
      }
    } catch {
      // silent
    }
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
      const res = await fetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "生成失败");
      }
      toast.success("内容方案已生成");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleVideoGenerate() {
    if (videoSubmitting) return;
    setVideoSubmitting(true);
    setVideoProgress(0);
    try {
      const res = await fetch(`/api/projects/${project.id}/video`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "视频生成失败");
      }
      toast.info("视频生成已提交，请等待完成");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "视频生成失败");
    } finally {
      setVideoSubmitting(false);
    }
  }

  async function handlePublish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/publish`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "发布失败");
      }
      toast.success("已成功发布到 TikTok");
      setConfirmPublish(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  function startEditing() {
    if (!cp) return;
    setEditData({
      script: cp.script,
      caption: cp.caption,
      videoPrompt: cp.videoPrompt,
    });
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
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "保存失败");
      }
      toast.success("内容已更新");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleAnalyze() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "分析失败");
      }
      toast.success("分析报告已生成");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("项目已删除");
      router.push("/projects");
    } catch {
      toast.error("删除失败");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const cp = project.contentPlan;
  const vj = project.videoJob;
  const angles = (cp?.contentAngles ?? []) as ContentAngle[];
  const canEdit =
    cp && ["CONTENT_GENERATED", "VIDEO_FAILED"].includes(project.status);

  return (
    <div className="space-y-6">
      {/* 顶部 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{project.keyword}</h2>
            <StatusBadge status={project.status} />
          </div>
          <p className="text-sm text-gray-500">
            创建于 {formatDate(project.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(project.status === "DRAFT" ||
            project.status === "CONTENT_GENERATED") && (
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {project.status === "DRAFT" ? "生成内容" : "重新生成"}
            </Button>
          )}
          {(project.status === "CONTENT_GENERATED" ||
            project.status === "VIDEO_FAILED") && (
            <Button
              variant="outline"
              onClick={handleVideoGenerate}
              disabled={videoSubmitting}
            >
              {videoSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Video className="mr-2 h-4 w-4" />
              )}
              生成视频
            </Button>
          )}
          {(project.status === "VIDEO_READY" ||
            project.status === "PUBLISH_FAILED") &&
            (!confirmPublish ? (
              <Button variant="outline" onClick={() => setConfirmPublish(true)}>
                <Send className="mr-2 h-4 w-4" />
                发布到 TikTok
              </Button>
            ) : (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  onClick={handlePublish}
                  disabled={publishing}
                >
                  {publishing ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                  )}
                  确认发布
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmPublish(false)}
                  disabled={publishing}
                >
                  取消
                </Button>
              </div>
            ))}
          {(project.status === "PUBLISHED" ||
            project.status === "ANALYTICS_FETCHED" ||
            project.status === "ANALYTICS_PENDING" ||
            project.status === "ANALYZED") && (
            <Button
              variant="outline"
              onClick={handleAnalyze}
              disabled={analyzing}
            >
              {analyzing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BarChart3 className="mr-2 h-4 w-4" />
              )}
              {project.status === "ANALYZED" ? "重新分析" : "拉取数据 & 分析"}
            </Button>
          )}
          {!confirmDelete ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setConfirmDelete(true)}
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                确认删除
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                取消
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 进度步骤条 */}
      <Card>
        <CardContent className="py-4">
          <StatusStepper status={project.status} />
        </CardContent>
      </Card>

      {/* 错误提示 */}
      {project.errorMessage && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{project.errorMessage}</p>
          </CardContent>
        </Card>
      )}

      {/* DRAFT 引导 */}
      {project.status === "DRAFT" && !cp && (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <Sparkles className="h-10 w-10 text-gray-300 mb-3" />
            <h3 className="text-lg font-medium mb-1">准备生成内容</h3>
            <p className="text-sm text-gray-500 mb-4">
              点击上方「生成内容」按钮，AI 将为「{project.keyword}
              」生成完整的短视频内容方案
            </p>
          </CardContent>
        </Card>
      )}

      {/* 视频生成进度 */}
      {isVideoGenerating && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
              视频生成中
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="h-2 w-full bg-yellow-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-500 rounded-full transition-all duration-500"
                  style={{ width: `${videoProgress}%` }}
                />
              </div>
              <p className="text-sm text-yellow-700">
                AI 正在生成视频... {videoProgress}%
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 视频预览 */}
      {vj?.status === "COMPLETED" && vj.videoUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="h-4 w-4" />
              视频预览
            </CardTitle>
            <CardDescription>
              视频已生成完成，请预览确认
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative aspect-[9/16] max-w-sm mx-auto bg-black rounded-lg overflow-hidden">
              <video
                src={vj.videoUrl}
                controls
                className="w-full h-full object-contain"
                poster={vj.thumbnailUrl || undefined}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
              <span>Provider: {vj.provider}</span>
              {vj.completedAt && (
                <span>生成于 {formatDate(vj.completedAt)}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 视频生成失败 */}
      {project.status === "VIDEO_FAILED" && vj && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-red-700">
              <AlertCircle className="h-4 w-4" />
              视频生成失败
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-600 mb-3">
              {vj.errorMessage || "未知错误"}
            </p>
            <p className="text-xs text-gray-500">
              已重试 {vj.retryCount} 次。点击上方「生成视频」按钮重试。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 发布中 */}
      {project.status === "PUBLISHING" && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="flex items-center gap-3 py-4">
            <Clock className="h-5 w-5 text-blue-500 animate-pulse" />
            <div>
              <p className="text-sm font-medium text-blue-700">
                正在发布到 TikTok...
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                视频正在上传到 TikTok，处理可能需要几分钟
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 发布成功 */}
      {project.publication?.publishStatus === "PUBLISHED" && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-green-700">
              <Send className="h-4 w-4" />
              已发布到 TikTok
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm text-green-700">
              <span>
                视频 ID: {project.publication.platformVideoId || "N/A"}
              </span>
              {project.publication.publishedAt && (
                <span>
                  发布于 {formatDate(project.publication.publishedAt)}
                </span>
              )}
            </div>
            {project.publication.snapshots?.[0] && (
              <div className="mt-3 grid grid-cols-4 gap-3">
                {[
                  { label: "播放", value: project.publication.snapshots[0].views },
                  { label: "点赞", value: project.publication.snapshots[0].likes },
                  { label: "评论", value: project.publication.snapshots[0].comments },
                  { label: "分享", value: project.publication.snapshots[0].shares },
                ].map((m) => (
                  <div key={m.label} className="text-center">
                    <p className="text-lg font-bold text-green-800">
                      {m.value.toLocaleString()}
                    </p>
                    <p className="text-xs text-green-600">{m.label}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 内容方案展示 */}
      {cp && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* 编辑/只读切换栏 */}
          {canEdit && (
            <div className="md:col-span-2 flex justify-end gap-2">
              {!editing ? (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <Pencil className="mr-1.5 h-3 w-3" />
                  编辑内容
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
                    {saving ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-3 w-3" />
                    )}
                    保存
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    <X className="mr-1.5 h-3 w-3" />
                    取消
                  </Button>
                </>
              )}
            </div>
          )}

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                视频脚本
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <Textarea
                  value={editData.script}
                  onChange={(e) =>
                    setEditData((d) => ({ ...d, script: e.target.value }))
                  }
                  rows={6}
                  className="text-sm"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {cp.script}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Send className="h-4 w-4" />
                TikTok 标题
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <Input
                  value={editData.caption}
                  onChange={(e) =>
                    setEditData((d) => ({ ...d, caption: e.target.value }))
                  }
                  className="text-sm"
                />
              ) : (
                <p className="text-sm">{cp.caption}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Hash className="h-4 w-4" />
                Hashtags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {cp.hashtags.map((tag, i) => (
                  <Badge key={i} variant="secondary">
                    {tag.startsWith("#") ? tag : `#${tag}`}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4" />
                视频提示词
              </CardTitle>
              <CardDescription>用于 AI 视频生成</CardDescription>
            </CardHeader>
            <CardContent>
              {editing ? (
                <Textarea
                  value={editData.videoPrompt}
                  onChange={(e) =>
                    setEditData((d) => ({ ...d, videoPrompt: e.target.value }))
                  }
                  rows={3}
                  className="text-sm"
                />
              ) : (
                <p className="text-sm text-gray-600 italic">{cp.videoPrompt}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lightbulb className="h-4 w-4" />
                内容角度建议
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {angles.map((a, i) => (
                <div key={i}>
                  <p className="text-sm font-medium">{a.angle}</p>
                  <p className="text-xs text-gray-500">{a.reason}</p>
                  {i < angles.length - 1 && <Separator className="mt-3" />}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardContent className="py-3">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>模型: {cp.modelUsed}</span>
                <span>生成于 {formatDate(cp.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 分析报告 */}
      {project.analysisReport && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              数据分析报告
            </CardTitle>
            {project.analysisReport.overallScore !== null && (
              <CardDescription>
                综合评分：
                <span className="font-bold text-lg ml-1">
                  {project.analysisReport.overallScore}
                </span>
                <span className="text-gray-400"> / 100</span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-1">表现总结</h4>
              <p className="text-sm text-gray-600">
                {project.analysisReport.performanceSummary}
              </p>
            </div>
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-1">方向建议</h4>
              <p className="text-sm text-gray-600">
                {project.analysisReport.directionAdvice}
              </p>
            </div>
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-1">优化建议</h4>
              <ul className="space-y-1">
                {project.analysisReport.optimizationTips.map((tip, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2">
                    <span className="text-gray-400 shrink-0">{i + 1}.</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
