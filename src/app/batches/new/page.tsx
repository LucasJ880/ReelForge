"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Zap,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function NewBatchPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [duration, setDuration] = useState("5");
  const [ratio, setRatio] = useState("9:16");
  const [resolution, setResolution] = useState("720p");
  const [concurrency, setConcurrency] = useState("2");
  const [autoVideo, setAutoVideo] = useState(true);

  const set = (fn: (v: string) => void) => (v: string | null) => {
    if (v !== null) fn(v);
  };

  const keywords = keywordsText
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || keywords.length === 0 || loading) return;

    setLoading(true);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          keywords,
          videoParams: {
            duration: parseInt(duration),
            ratio,
            resolution,
          },
          concurrency: parseInt(concurrency),
          autoGenerateVideo: autoVideo,
          autoStart: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "创建失败");
      }

      const batch = await res.json();
      toast.success(`批次已创建，${keywords.length} 个项目开始处理`);
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">批量生成</h2>
        <p className="text-gray-500 mt-1">
          输入多个关键词，一次性生成多个视频
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              基本信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">批次名称</label>
              <Input
                placeholder="例如：宠物用品系列、美食探店第一批..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">关键词列表</label>
                <span className="text-xs text-gray-400">
                  每行一个，已识别 {keywords.length} 个
                </span>
              </div>
              <Textarea
                placeholder={"宠物用品推荐\n健身教程\n美食探店\n旅行攻略\n数码产品评测"}
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                disabled={loading}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle
              className="flex items-center justify-between text-base cursor-pointer"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                高级设置
              </span>
              <span className="text-xs text-gray-400">
                {showAdvanced ? "收起" : "展开"}
              </span>
            </CardTitle>
            {!showAdvanced && (
              <CardDescription>
                默认: 5秒视频, 9:16竖屏, 720p, 并发2
              </CardDescription>
            )}
          </CardHeader>
          {showAdvanced && (
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">视频时长</label>
                  <Select value={duration} onValueChange={set(setDuration)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 秒</SelectItem>
                      <SelectItem value="10">10 秒</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">画面比例</label>
                  <Select value={ratio} onValueChange={set(setRatio)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9:16">9:16 竖屏</SelectItem>
                      <SelectItem value="16:9">16:9 横屏</SelectItem>
                      <SelectItem value="1:1">1:1 方形</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">分辨率</label>
                  <Select value={resolution} onValueChange={set(setResolution)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="720p">720p</SelectItem>
                      <SelectItem value="1080p">1080p</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">并发数</label>
                  <Select value={concurrency} onValueChange={set(setConcurrency)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1（保守）</SelectItem>
                      <SelectItem value="2">2（推荐）</SelectItem>
                      <SelectItem value="3">3（较快）</SelectItem>
                      <SelectItem value="5">5（最快）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="autoVideo"
                    checked={autoVideo}
                    onChange={(e) => setAutoVideo(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="autoVideo" className="text-sm">
                    自动生成视频（关闭后只生成内容方案）
                  </label>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        <Button
          type="submit"
          disabled={!name.trim() || keywords.length === 0 || loading}
          className="w-full"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在创建批次...
            </>
          ) : (
            <>
              <Zap className="mr-2 h-4 w-4" />
              创建并启动批次（{keywords.length} 个视频）
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
