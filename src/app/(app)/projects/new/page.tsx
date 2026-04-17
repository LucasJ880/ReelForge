"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  ImagePlus,
  Star,
  Trash2,
  Lock,
  Zap,
  Gift,
  FileText,
  Info,
} from "lucide-react";
import Link from "next/link";
import { useIsAdmin } from "@/lib/hooks/use-role";
import { cn } from "@/lib/utils";

type Channel = "pro" | "free" | "content-only";

interface ChannelOption {
  id: Channel;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  title: string;
  subtitle: string;
  cost: string;
  duration: string;
}

const CHANNELS: ChannelOption[] = [
  {
    id: "pro",
    icon: Zap,
    badge: "推荐",
    title: "一键 Pro",
    subtitle: "AI 文案 + Seedance 高质量视频",
    cost: "付费 · 云端生成",
    duration: "约 1–2 分钟",
  },
  {
    id: "free",
    icon: Gift,
    badge: "免费",
    title: "一键 Free",
    subtitle: "AI 文案 + 浏览器合成（Pexels + TTS）",
    cost: "零成本 · 浏览器本地合成",
    duration: "约 3–5 分钟",
  },
  {
    id: "content-only",
    icon: FileText,
    title: "仅生成文案",
    subtitle: "只生成脚本、标题、提示词，视频之后再做",
    cost: "极少 AI 成本",
    duration: "约 10 秒",
  },
];

const suggestions = [
  "冬日居家好物",
  "办公室午睡神器",
  "宠物日常",
  "助眠推荐",
  "圣诞礼物清单",
  "测评对比",
  "情侣居家",
  "旅行打卡",
  "健身打卡",
  "美食探店",
];

export default function NewProjectPage() {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [keyword, setKeyword] = useState("");
  const [brandDescription, setBrandDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "creating" | "generating">("input");
  const [channel, setChannel] = useState<Channel>("pro");

  const [uploadedImages, setUploadedImages] = useState<{ url: string; filename: string }[]>([]);
  const [primaryImageUrl, setPrimaryImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function uploadFiles(files: FileList | File[]) {
    const fileArr = Array.from(files).slice(0, 5 - uploadedImages.length);
    if (fileArr.length === 0) {
      if (uploadedImages.length >= 5) toast.error("最多上传 5 张图片");
      return;
    }

    setUploading(true);
    const results: { url: string; filename: string }[] = [];
    for (const file of fileArr) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        toast.error(`${file.name}: 仅支持 JPEG/PNG/WebP`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: 超过 10MB`);
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "上传失败");
        }
        const data = await res.json();
        results.push({ url: data.url, filename: data.filename });
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "上传失败"}`);
      }
    }

    if (results.length > 0) {
      const newList = [...uploadedImages, ...results];
      setUploadedImages(newList);
      if (!primaryImageUrl) setPrimaryImageUrl(results[0].url);
      toast.success(`已上传 ${results.length} 张图片`);
    }
    setUploading(false);
  }

  function removeImage(url: string) {
    const newList = uploadedImages.filter((img) => img.url !== url);
    setUploadedImages(newList);
    if (primaryImageUrl === url) {
      setPrimaryImageUrl(newList[0]?.url || null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim() || loading) return;

    setLoading(true);
    try {
      setStep("creating");
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          brandDescription: brandDescription.trim() || null,
          imageUrls: uploadedImages.map((img) => img.url),
          primaryImageUrl,
        }),
      });
      if (!res.ok) throw new Error("创建失败");
      const project = await res.json();

      setStep("generating");

      if (channel === "content-only") {
        const genRes = await fetch(`/api/projects/${project.id}/generate`, {
          method: "POST",
        });
        if (!genRes.ok) {
          toast.warning("项目已创建，但内容生成失败，请在详情页重试");
        } else {
          toast.success("内容方案已生成，接下来可以生成视频");
        }
      } else if (channel === "pro") {
        const proRes = await fetch(`/api/projects/${project.id}/auto-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "pro" }),
        });
        if (!proRes.ok) {
          const err = await proRes.json().catch(() => ({}));
          toast.warning(err.error || "项目已创建，视频提交失败，可去详情页手动重试");
        } else {
          toast.success("一键生成已启动，视频正在合成");
        }
      } else if (channel === "free") {
        const freeRes = await fetch(`/api/projects/${project.id}/free-prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!freeRes.ok) {
          const err = await freeRes.json().catch(() => ({}));
          toast.warning(err.error || "项目已创建，Free 通道准备失败，可去详情页手动重试");
        } else {
          toast.success("已为免费通道准备素材，接下来浏览器会自动合成视频");
        }
      }

      router.push(`/projects/${project.id}`);
    } catch {
      toast.error("操作失败，请重试");
      setStep("input");
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto pt-24 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-card border border-border">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-3">需要管理员权限</h1>
        <p className="text-sm text-muted-foreground mb-6">
          创建新作品与视频生成会产生 AI 调用费用，目前仅管理员可操作。
        </p>
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          返回作品库
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pt-8 sm:pt-16">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">
          新作品
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-white">
          用关键词 + 可选参考资料，一键生成短视频
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          输入创意方向，任选是否上传参考图或自由描述自己的品牌/场景 —— AI 会生成脚本、标题、提示词和视频。
        </p>
      </div>

      {/* Channel picker - 让用户在创建时就明确接下来走哪条路 */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          <Zap className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          生成通道
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          {CHANNELS.map((opt) => {
            const Icon = opt.icon;
            const active = channel === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setChannel(opt.id)}
                disabled={loading}
                className={cn(
                  "relative text-left rounded-xl border p-3.5 transition-all disabled:opacity-50",
                  active
                    ? "border-primary/60 bg-primary/[0.08] ring-2 ring-primary/30"
                    : "border-border bg-card/60 hover:border-primary/30 hover:bg-accent/40",
                )}
              >
                {opt.badge && (
                  <span
                    className={cn(
                      "absolute right-2.5 top-2.5 rounded-full px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider",
                      opt.id === "pro"
                        ? "bg-primary/20 text-primary"
                        : "bg-emerald-500/15 text-emerald-400",
                    )}
                  >
                    {opt.badge}
                  </span>
                )}
                <div className="flex items-center gap-2 mb-1.5">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md",
                      active ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      active ? "text-foreground" : "text-foreground/90",
                    )}
                  >
                    {opt.title}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground mb-2">
                  {opt.subtitle}
                </p>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
                  <span>{opt.duration}</span>
                  <span className={active ? "text-primary" : ""}>{opt.cost}</span>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {channel === "pro" &&
            "付费通道：使用 Seedance 引擎直接生成高画质商业级视频，质量最稳定。"}
          {channel === "free" &&
            "免费通道：参考 MoneyPrinterTurbo 思路，基于 Pexels 素材 + Edge TTS 在你的浏览器里本地合成，不花钱，但画面质量受素材库限制。"}
          {channel === "content-only" &&
            "只跑文案，适合先过一轮脚本再决定是否生成视频。"}
        </p>
      </div>

      {/* Brand / product / scene description - 可选自由文本 */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          <Info className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          品牌 / 产品 / 场景描述（可选）
        </label>
        <textarea
          rows={3}
          value={brandDescription}
          onChange={(e) => setBrandDescription(e.target.value)}
          disabled={loading}
          placeholder="例：我的品牌叫 CozyNest，主打羊羔绒毛毯，特点是超柔触感、双面亲肤、冬天保暖。预算档位：¥199–299。/ 或者：我在做自媒体副业，这条视频想走治愈系居家风格。"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-white placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all resize-none disabled:opacity-50"
        />
        <p className="text-[10px] text-muted-foreground/70 mt-1.5 leading-relaxed">
          空着也行，留白时 AI 会按关键词自由发挥。填上之后，脚本和视频会围绕你描述的信息展开。
        </p>
      </div>

      {/* Reference image upload */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          <ImagePlus className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          参考图 / Logo / 产品图（可选，最多 5 张）
        </label>

        {uploadedImages.length > 0 && (
          <div className="grid grid-cols-5 gap-2 mb-2">
            {uploadedImages.map((img) => (
              <div
                key={img.url}
                className={`group relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                  primaryImageUrl === img.url
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40"
                }`}
                onClick={() => setPrimaryImageUrl(img.url)}
              >
                <img
                  src={img.url}
                  alt=""
                  className="w-full aspect-square object-cover"
                />
                {primaryImageUrl === img.url && (
                  <div className="absolute top-1 left-1 rounded-full bg-primary p-0.5">
                    <Star className="h-2.5 w-2.5 text-white fill-white" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(img.url);
                  }}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                >
                  <Trash2 className="h-2.5 w-2.5 text-white" />
                </button>
                {primaryImageUrl !== img.url && (
                  <div className="absolute inset-x-0 bottom-0 bg-black/50 text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[8px] text-white">设为主图</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {uploadedImages.length < 5 && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`relative rounded-xl border border-dashed px-4 py-4 text-center transition-all ${
              dragOver
                ? "border-primary bg-primary/10"
                : "border-border bg-card/60 hover:border-primary/40"
            } ${uploading ? "pointer-events-none opacity-50" : ""}`}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => e.target.files && uploadFiles(e.target.files)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={uploading || loading}
            />
            {uploading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                上传中...
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <ImagePlus className="mx-auto h-5 w-5 mb-1 text-muted-foreground/70" />
                拖拽或点击上传参考图
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">JPEG, PNG, WebP · 每张 ≤ 10MB</p>
              </div>
            )}
          </div>
        )}

        {uploadedImages.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            <Star className="inline h-2.5 w-2.5 text-primary fill-primary -mt-0.5 mr-0.5" />
            带框的是主图，将传入 Seedance 做图生视频；并且所有上传图都会被 GPT-4o Vision 分析，自动注入脚本和视频提示词。
          </p>
        )}
      </div>

      {/* Keyword Input */}
      <form onSubmit={handleSubmit}>
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          <Sparkles className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          创意方向关键词
        </label>
        <div className="rounded-2xl border border-border bg-card p-1 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <input
            type="text"
            placeholder="描述你想创作的视频方向，如『冬日居家好物』『宠物日常』..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            disabled={loading}
            autoFocus
            className="w-full bg-transparent px-4 py-4 text-base text-white placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {suggestions.slice(0, 4).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setKeyword(s)}
                  className="rounded-full bg-accent/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={!keyword.trim() || loading}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {loading
                ? step === "creating"
                  ? "创建中..."
                  : channel === "pro"
                    ? "提交 Pro 任务..."
                    : channel === "free"
                      ? "准备免费素材..."
                      : "生成文案中..."
                : channel === "pro"
                  ? "一键 Pro 生成"
                  : channel === "free"
                    ? "一键 Free 生成"
                    : "生成文案"}
            </button>
          </div>
        </div>
      </form>

      {!loading && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {suggestions.slice(4).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setKeyword(s)}
              className="rounded-full bg-secondary/30 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {step === "generating" && (
        <div className="mt-6 flex items-center gap-3 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {channel === "pro" && (
              <>为「{keyword}」自动生成文案并提交 Seedance 视频任务...</>
            )}
            {channel === "free" && (
              <>为「{keyword}」准备免费素材（文案 + Pexels + TTS）...</>
            )}
            {channel === "content-only" && (
              <>为「{keyword}」构思内容方案...</>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
