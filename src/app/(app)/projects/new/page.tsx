"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, Package, ChevronDown, Check } from "lucide-react";

interface Product {
  id: string;
  name: string;
  productLine: string;
  color: string;
  description: string;
  features: string[];
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

export default function NewProjectPage() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "creating" | "generating">("input");

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [productFilter, setProductFilter] = useState<string>("");

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => setProducts(data))
      .catch(() => toast.error("加载产品列表失败"));
  }, []);

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
                {/* "No product" option */}
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

      {/* More suggestions */}
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
            AI 正在为
            {selectedProduct && `「${selectedProduct.color}」× `}
            「{keyword}」构思内容方案...
          </span>
        </div>
      )}
    </div>
  );
}
