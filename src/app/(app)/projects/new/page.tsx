"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Package,
  ChevronDown,
  Check,
  Flame,
  X,
  Eye,
  Heart,
  ImagePlus,
  Star,
  Trash2,
} from "lucide-react";

interface Product {
  id: string;
  name: string;
  productLine: string;
  color: string;
  description: string;
  features: string[];
}

interface TrendRef {
  id: string;
  platform: string;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  styleAnalysis: Record<string, string> | null;
  visualAnalysis: Record<string, string> | null;
}

const suggestions = [
  "宠物+毛毯",
  "冬日居家好物",
  "沙发追剧神器",
  "助眠好物",
  "圣诞礼物推荐",
  "办公室午睡毯",
  "卧室氛围感",
  "加拿大冬天生存指南",
  "毛毯测评对比",
  "情侣居家日常",
];

const productLineLabels: Record<string, string> = {
  flannel: "法兰绒毛毯",
  sherpa: "Sherpa双面毛毯",
};

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  tiktok: { label: "TikTok", color: "bg-pink-500/15 text-pink-400" },
  instagram: { label: "Instagram", color: "bg-purple-500/15 text-purple-400" },
  facebook: { label: "Facebook", color: "bg-blue-500/15 text-blue-400" },
};

function formatCount(n: number | null | undefined): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function NewProjectPage() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "creating" | "generating">("input");

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [productFilter, setProductFilter] = useState<string>("");

  const [trendLibrary, setTrendLibrary] = useState<TrendRef[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<TrendRef[]>([]);
  const [refPickerOpen, setRefPickerOpen] = useState(false);

  const [uploadedImages, setUploadedImages] = useState<{ url: string; filename: string }[]>([]);
  const [primaryImageUrl, setPrimaryImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => setProducts(data))
      .catch(() => toast.error("加载产品列表失败"));
  }, []);

  useEffect(() => {
    if (refPickerOpen && trendLibrary.length === 0) {
      fetch("/api/trends?limit=50")
        .then((r) => r.json())
        .then(setTrendLibrary)
        .catch(() => toast.error("加载参考库失败"));
    }
  }, [refPickerOpen, trendLibrary.length]);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const filteredProducts = products.filter((p) => {
    if (!productFilter) return true;
    const q = productFilter.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.color.toLowerCase().includes(q) ||
      p.productLine.toLowerCase().includes(q)
    );
  });

  const groupedProducts = filteredProducts.reduce(
    (acc, p) => {
      const key = p.productLine;
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    },
    {} as Record<string, Product[]>
  );

  function toggleRef(ref: TrendRef) {
    setSelectedRefs((prev) => {
      const exists = prev.find((r) => r.id === ref.id);
      if (exists) return prev.filter((r) => r.id !== ref.id);
      if (prev.length >= 3) {
        toast.error("最多选择 3 个参考");
        return prev;
      }
      return [...prev, ref];
    });
  }

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
          productId: selectedProductId,
          trendRefId: selectedRefs[0]?.id || null,
          imageUrls: uploadedImages.map((img) => img.url),
          primaryImageUrl,
        }),
      });
      if (!res.ok) throw new Error("创建失败");
      const project = await res.json();

      setStep("generating");
      const genRes = await fetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
      });

      if (!genRes.ok) {
        toast.warning("项目已创建，但内容生成失败，请在详情页重试");
      } else {
        toast.success("内容方案已生成");
      }

      router.push(`/projects/${project.id}`);
    } catch {
      toast.error("操作失败，请重试");
      setStep("input");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto pt-8 sm:pt-16">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-2">
          新作品
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-white">
          选择产品，输入创意方向
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          AI 将结合产品信息与创意关键词，生成针对性的脚本、标题和视频提示词
        </p>
      </div>

      {/* Product Selector */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-zinc-400 mb-2">
          <Package className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          关联产品（推荐选择）
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setProductDropdownOpen(!productDropdownOpen)}
            disabled={loading}
            className="w-full flex items-center justify-between rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-left transition-all hover:border-zinc-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none disabled:opacity-50"
          >
            {selectedProduct ? (
              <span className="text-white">
                <span className="text-violet-400 text-xs mr-2">
                  {productLineLabels[selectedProduct.productLine]}
                </span>
                {selectedProduct.color}
              </span>
            ) : (
              <span className="text-zinc-500">选择一个毛毯产品...</span>
            )}
            <ChevronDown
              className={`h-4 w-4 text-zinc-500 transition-transform ${
                productDropdownOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {productDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/50 max-h-72 overflow-hidden">
              <div className="p-2 border-b border-zinc-800">
                <input
                  type="text"
                  placeholder="搜索产品或花色..."
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  autoFocus
                  className="w-full bg-zinc-800/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                />
              </div>
              <div className="overflow-y-auto max-h-52 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProductId(null);
                    setProductDropdownOpen(false);
                    setProductFilter("");
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    {!selectedProductId && <Check className="h-3.5 w-3.5 text-violet-400" />}
                  </div>
                  不关联产品（通用模式）
                </button>

                {Object.entries(groupedProducts).map(([line, items]) => (
                  <div key={line}>
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
                      {productLineLabels[line] || line}
                    </div>
                    {items.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedProductId(p.id);
                          setProductDropdownOpen(false);
                          setProductFilter("");
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white hover:bg-zinc-800 transition-colors"
                      >
                        <div className="w-4 h-4 flex items-center justify-center">
                          {selectedProductId === p.id && (
                            <Check className="h-3.5 w-3.5 text-violet-400" />
                          )}
                        </div>
                        {p.color}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {selectedProduct && (
          <div className="mt-2 rounded-lg bg-violet-500/5 border border-violet-500/10 px-3 py-2">
            <p className="text-xs text-zinc-400 leading-relaxed">
              <span className="text-violet-400 font-medium">{selectedProduct.name}</span>
              {" — "}
              {selectedProduct.features.slice(0, 3).join("、")}
            </p>
          </div>
        )}
      </div>

      {/* Trend Reference Selector */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-zinc-400 mb-2">
          <Flame className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          参考爆款（可选，最多 3 个）
        </label>

        {selectedRefs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {selectedRefs.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5"
              >
                {ref.thumbnailUrl && (
                  <img
                    src={ref.thumbnailUrl}
                    alt=""
                    className="w-8 h-10 rounded object-cover"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-[11px] text-white truncate max-w-[120px]">
                    {ref.title || "无标题"}
                  </p>
                  <span
                    className={`inline-block rounded-full px-1.5 py-0.5 text-[8px] font-medium ${PLATFORM_LABELS[ref.platform]?.color || "bg-zinc-800 text-zinc-400"}`}
                  >
                    {PLATFORM_LABELS[ref.platform]?.label || ref.platform}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleRef(ref)}
                  className="text-zinc-500 hover:text-white transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setRefPickerOpen(true)}
          disabled={loading}
          className="w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-500 hover:border-amber-500/40 hover:text-amber-400 transition-all disabled:opacity-50"
        >
          {selectedRefs.length > 0
            ? `+ 添加更多参考（已选 ${selectedRefs.length}/3）`
            : "从参考库选择爆款视频..."}
        </button>
      </div>

      {/* Product Image Upload */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-zinc-400 mb-2">
          <ImagePlus className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          产品图 / Logo（可选，最多 5 张）
        </label>

        {uploadedImages.length > 0 && (
          <div className="grid grid-cols-5 gap-2 mb-2">
            {uploadedImages.map((img) => (
              <div
                key={img.url}
                className={`group relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                  primaryImageUrl === img.url
                    ? "border-violet-500 ring-2 ring-violet-500/20"
                    : "border-zinc-700 hover:border-zinc-600"
                }`}
                onClick={() => setPrimaryImageUrl(img.url)}
              >
                <img
                  src={img.url}
                  alt=""
                  className="w-full aspect-square object-cover"
                />
                {primaryImageUrl === img.url && (
                  <div className="absolute top-1 left-1 rounded-full bg-violet-500 p-0.5">
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
                ? "border-violet-500 bg-violet-500/5"
                : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600"
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
              <div className="flex items-center justify-center gap-2 text-sm text-violet-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                上传中...
              </div>
            ) : (
              <div className="text-sm text-zinc-500">
                <ImagePlus className="mx-auto h-5 w-5 mb-1 text-zinc-600" />
                拖拽或点击上传产品图 / Logo
                <p className="text-[10px] text-zinc-600 mt-0.5">JPEG, PNG, WebP · 每张 ≤ 10MB</p>
              </div>
            )}
          </div>
        )}

        {uploadedImages.length > 0 && (
          <p className="text-[10px] text-zinc-500 mt-1.5">
            <Star className="inline h-2.5 w-2.5 text-violet-400 fill-violet-400 -mt-0.5 mr-0.5" />
            带紫框的为主图，将传入 Seedance 做图生视频。点击切换主图。
          </p>
        )}
      </div>

      {/* Keyword Input */}
      <form onSubmit={handleSubmit}>
        <label className="block text-xs font-medium text-zinc-400 mb-2">
          <Sparkles className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          创意方向关键词
        </label>
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-1 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20 transition-all">
          <input
            type="text"
            placeholder={
              selectedProduct
                ? `为「${selectedProduct.color}」想一个创意角度...`
                : "描述你想创作的视频方向..."
            }
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            disabled={loading}
            autoFocus={!products.length}
            className="w-full bg-transparent px-4 py-4 text-base text-white placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {suggestions.slice(0, 4).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setKeyword(s)}
                  className="rounded-full bg-zinc-800/50 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-violet-500/10 hover:text-violet-400 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={!keyword.trim() || loading}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {loading
                ? step === "creating"
                  ? "创建中..."
                  : "生成中..."
                : "生成"}
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
              className="rounded-full bg-zinc-800/30 px-2.5 py-1 text-[11px] text-zinc-500 hover:bg-violet-500/10 hover:text-violet-400 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {step === "generating" && (
        <div className="mt-6 flex items-center gap-3 text-sm text-violet-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            AI 正在
            {selectedRefs.length > 0 ? "参考爆款风格，" : ""}
            为
            {selectedProduct && `「${selectedProduct.color}」× `}
            「{keyword}」构思内容方案...
          </span>
        </div>
      )}

      {/* Reference Picker Modal */}
      {refPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setRefPickerOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                从参考库选择（已选 {selectedRefs.length}/3）
              </h3>
              <button
                onClick={() => setRefPickerOpen(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {trendLibrary.length === 0 ? (
              <div className="text-center py-12 text-zinc-600 text-sm">
                参考库为空，先去
                <a href="/trends" className="text-amber-400 hover:underline ml-1">
                  爆款参考库
                </a>
                {" "}搜索入库
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {trendLibrary.map((ref) => {
                  const isSelected = selectedRefs.some((r) => r.id === ref.id);
                  return (
                    <div
                      key={ref.id}
                      onClick={() => toggleRef(ref)}
                      className={`group rounded-xl border overflow-hidden cursor-pointer transition-all ${
                        isSelected
                          ? "border-amber-500/40 bg-amber-500/5 ring-1 ring-amber-500/20"
                          : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      {ref.thumbnailUrl && (
                        <div className="relative">
                          <img
                            src={ref.thumbnailUrl}
                            alt=""
                            className="w-full h-24 object-cover"
                          />
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 rounded-full bg-amber-500 p-0.5">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                          <span
                            className={`absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-0.5 text-[8px] font-medium backdrop-blur-sm ${PLATFORM_LABELS[ref.platform]?.color || "bg-zinc-800 text-zinc-400"}`}
                          >
                            {PLATFORM_LABELS[ref.platform]?.label}
                          </span>
                        </div>
                      )}
                      <div className="p-2">
                        <p className="text-[11px] text-white line-clamp-1">
                          {ref.title || "无标题"}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="flex items-center gap-0.5 text-[9px] text-zinc-500">
                            <Eye className="h-2.5 w-2.5" />
                            {formatCount(ref.viewCount)}
                          </span>
                          <span className="flex items-center gap-0.5 text-[9px] text-zinc-500">
                            <Heart className="h-2.5 w-2.5" />
                            {formatCount(ref.likeCount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setRefPickerOpen(false)}
                className="rounded-lg bg-amber-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors"
              >
                确定（{selectedRefs.length} 个）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
