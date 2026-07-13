import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Play, Plus } from "lucide-react";

export const metadata = {
  title: "Editorial Studio · Design System",
};

export default function DesignSystemPage() {
  return (
    <main className="editorial-page space-y-12">
      <header className="max-w-4xl space-y-4">
        <p className="text-meta font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          Aivora Design System
        </p>
        <h1 className="editorial-display">
          Editorial <em>Studio</em>
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          日光、纸张与编辑台的秩序。所有颜色、圆角、阴影、字号与动效均来自同一套语义
          token。
        </p>
      </header>

      <section aria-labelledby="typography-heading" className="space-y-6">
        <h2 id="typography-heading" className="font-heading text-section font-normal">
          排版层级
        </h2>
        <Card>
          <CardContent className="space-y-5">
            <p className="font-heading text-section">章节标题 · 32</p>
            <p className="font-heading text-title">卡片标题 · 24</p>
            <p className="text-subhead">强调正文 · 18</p>
            <p className="text-body">标准正文 · 15 / 1.6，用于完整描述与表单内容。</p>
            <p className="text-meta text-muted-foreground">辅助信息 · 13</p>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="actions-heading" className="space-y-6">
        <h2 id="actions-heading" className="font-heading text-section font-normal">
          操作与状态
        </h2>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4">
            <Button>
              <Plus />
              新建视频
            </Button>
            <Button variant="outline">
              查看项目
              <ArrowRight />
            </Button>
            <Button variant="ghost">
              <Play />
              预览
            </Button>
            <Button variant="destructive">删除任务</Button>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-6">
            <Badge>生成中</Badge>
            <Badge variant="success">已完成</Badge>
            <Badge variant="warning">待审核</Badge>
            <Badge variant="destructive">生成失败</Badge>
          </CardFooter>
        </Card>
      </section>

      <section aria-labelledby="forms-heading" className="space-y-6">
        <h2 id="forms-heading" className="font-heading text-section font-normal">
          表单与反馈
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>视频信息</CardTitle>
              <CardDescription>字段采用一致的 40px 控件高度和明确焦点态。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="grid gap-2 text-meta font-medium">
                产品名称
                <Input placeholder="例如：晨光保温杯" />
              </label>
              <label className="grid gap-2 text-meta font-medium">
                视频风格
                <Select defaultValue="editorial">
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editorial">日光编辑台</SelectItem>
                    <SelectItem value="studio">白棚电商</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-meta font-medium">
                创意说明
                <Textarea placeholder="描述你希望强调的产品卖点" />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>批次进度</CardTitle>
              <CardDescription>进度以 2px 细线显示，数据来自后端真实状态。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <Progress value={64}>
                <ProgressLabel>已完成 64 / 100</ProgressLabel>
                <ProgressValue />
              </Progress>
              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>
                  打开模态框
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>确认开始生产？</DialogTitle>
                    <DialogDescription>
                      系统会按所选模板生成 100 条视频，并在监控页持续更新状态。
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button>开始生产</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="motion-heading" className="space-y-6">
        <h2 id="motion-heading" className="font-heading text-section font-normal">
          Reduced motion
        </h2>
        <Card>
          <CardHeader>
            <CardTitle>克制的反馈</CardTitle>
            <CardDescription>
              仅使用 120ms 与 200ms 两档 ease-out；系统开启减少动态效果后，过渡自动关闭。
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    </main>
  );
}
