"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NewProjectPage() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "creating" | "generating">("input");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim() || loading) return;

    setLoading(true);
    try {
      setStep("creating");
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim() }),
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
        toast.success("项目创建成功，内容方案已生成");
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
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            新建视频项目
          </CardTitle>
          <CardDescription>
            输入中文关键词或产品方向，AI 将自动生成完整的内容方案
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">关键词 / 方向</label>
              <Input
                placeholder="例如：宠物用品推荐、健身教程、美食探店..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
            <Button
              type="submit"
              disabled={!keyword.trim() || loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {step === "creating" && "正在创建项目..."}
                  {step === "generating" && "AI 正在生成内容方案..."}
                </>
              ) : (
                "创建项目并生成内容"
              )}
            </Button>
          </form>

          {step === "generating" && (
            <div className="mt-4 p-4 rounded-lg bg-blue-50 text-sm text-blue-700">
              <p className="font-medium">AI 正在工作中</p>
              <p className="mt-1">
                正在为「{keyword}」生成脚本、标题、Hashtags 和内容角度建议，请稍候...
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
