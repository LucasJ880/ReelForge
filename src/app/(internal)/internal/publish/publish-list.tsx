"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Download, Loader2, Send, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge, publishTone } from "@/components/features/status-badge";
import { PUBLISH_LABELS } from "@/lib/labels";
import type { PublishStatus } from "@prisma/client";

interface PublishItem {
  id: string;
  status: PublishStatus;
  externalPostId: string | null;
  publishUrl: string | null;
  videoBrief: {
    id: string;
    finalVideoUrl: string | null;
    contentAngle: {
      title: string;
      round: {
        roundIndex: number;
        deliveryOrder: { id: string; title: string };
      };
    };
  };
}

export function PublishList({ items }: { items: PublishItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forms, setForms] = useState<
    Record<string, { postId: string; url: string; note: string }>
  >({});

  async function call(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/publish/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "失败");
      }
      toast.success("已处理");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <Card className="p-8 text-center text-body text-muted-foreground">
        发布队列为空
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((r) => {
        const f = forms[r.id] ?? { postId: "", url: "", note: "" };
        const setForm = (patch: Partial<typeof f>) =>
          setForms({ ...forms, [r.id]: { ...f, ...patch } });
        return (
          <Card key={r.id}>
            <CardContent className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
              {r.videoBrief.finalVideoUrl ? (
                <video src={r.videoBrief.finalVideoUrl} controls className="w-full rounded-(--radius-md)" />
              ) : (
                <div className="flex aspect-9/16 items-center justify-center rounded-(--radius-md) bg-secondary text-meta text-muted-foreground">
                  无成片
                </div>
              )}

              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/briefs/${r.videoBrief.id}`}
                    className="font-medium hover:text-primary"
                  >
                    {r.videoBrief.contentAngle.title}
                  </Link>
                  <StatusBadge tone={publishTone(r.status)}>
                    {PUBLISH_LABELS[r.status]}
                  </StatusBadge>
                </div>
                <div className="text-meta text-muted-foreground">
                  {r.videoBrief.contentAngle.round.deliveryOrder.title} · 第{" "}
                  {r.videoBrief.contentAngle.round.roundIndex} 轮
                </div>

                <div className="flex flex-wrap gap-2">
                  {r.videoBrief.finalVideoUrl && (
                    <a
                      href={r.videoBrief.finalVideoUrl}
                      download
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === r.id}
                        onClick={() => call(r.id, { action: "download" })}
                      >
                        <Download strokeWidth={1.5} aria-hidden />
                        下载并标记
                      </Button>
                    </a>
                  )}
                </div>

                <div className="space-y-3 rounded-(--radius-md) border border-border p-4 text-meta">
                  <div className="text-meta font-medium text-muted-foreground">
                    上传 TikTok 后回填
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input
                      type="text"
                      placeholder="external_post_id（必填）"
                      value={f.postId}
                      onChange={(e) => setForm({ postId: e.target.value })}
                      aria-label="TikTok external post ID"
                    />
                    <Input
                      type="url"
                      placeholder="TikTok URL（可选）"
                      value={f.url}
                      onChange={(e) => setForm({ url: e.target.value })}
                      aria-label="TikTok URL"
                    />
                  </div>
                  <Input
                    type="text"
                    placeholder="运营备注"
                    value={f.note}
                    onChange={(e) => setForm({ note: e.target.value })}
                    aria-label="运营备注"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === r.id || !f.postId}
                      onClick={() =>
                        call(r.id, {
                          action: "submit",
                          externalPostId: f.postId,
                          publishUrl: f.url || undefined,
                          operatorNote: f.note || undefined,
                        })
                      }
                    >
                      {busyId === r.id ? (
                        <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />
                      ) : (
                        <Send strokeWidth={1.5} aria-hidden />
                      )}
                      提交 post_id
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === r.id || r.status !== "UPLOADED"}
                      onClick={() => call(r.id, { action: "confirm" })}
                    >
                      <CheckCircle2 strokeWidth={1.5} aria-hidden />
                      确认已上线
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === r.id}
                      onClick={() =>
                        call(r.id, {
                          action: "fail",
                          reason: f.note || "发布失败",
                        })
                      }
                    >
                      <XCircle strokeWidth={1.5} aria-hidden />
                      失败
                    </Button>
                  </div>
                  {r.externalPostId && (
                    <div className="text-meta text-muted-foreground">
                      当前 post_id: {r.externalPostId}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
