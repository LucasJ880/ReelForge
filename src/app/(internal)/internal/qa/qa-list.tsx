"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, X, RotateCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/features/status-badge";

interface QAItem {
  id: string;
  aiOverallScore: number | null;
  aiReviewRoute: string | null;
  aiIssues: unknown;
  reviewerComment: string | null;
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

export function QAList({ items }: { items: QAItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  async function decide(
    id: string,
    decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
  ) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/qa/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment: comments[id] || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "失败");
      }
      toast.success("审核已提交");
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
        审核队列为空
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((q) => {
        const issues = Array.isArray(q.aiIssues) ? (q.aiIssues as string[]) : [];
        return (
          <Card key={q.id}>
            <CardContent className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
              {q.videoBrief.finalVideoUrl ? (
                <video
                  src={q.videoBrief.finalVideoUrl}
                  controls
                  className="w-full rounded-(--radius-md)"
                />
              ) : (
                <div className="flex aspect-9/16 items-center justify-center rounded-(--radius-md) bg-secondary text-meta text-muted-foreground">
                  无成片 URL
                </div>
              )}

              <div className="flex flex-col gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/briefs/${q.videoBrief.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {q.videoBrief.contentAngle.title}
                    </Link>
                    <StatusBadge tone="info">
                      AI {q.aiOverallScore ?? "—"}
                    </StatusBadge>
                    {q.aiReviewRoute && (
                      <StatusBadge
                        tone={
                          q.aiReviewRoute === "auto_pass"
                            ? "success"
                            : q.aiReviewRoute === "reject"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {q.aiReviewRoute}
                      </StatusBadge>
                    )}
                  </div>
                  <div className="mt-1 text-meta text-muted-foreground">
                    {q.videoBrief.contentAngle.round.deliveryOrder.title} · 第{" "}
                    {q.videoBrief.contentAngle.round.roundIndex} 轮
                  </div>
                </div>

                {q.reviewerComment && (
                  <p className="rounded-(--radius-md) bg-secondary p-3 text-meta text-muted-foreground">
                    {q.reviewerComment}
                  </p>
                )}

                {issues.length > 0 && (
                  <ul className="list-disc space-y-1 pl-4 text-meta text-muted-foreground">
                    {issues.map((i, idx) => (
                      <li key={idx}>{i}</li>
                    ))}
                  </ul>
                )}

                <Textarea
                  rows={2}
                  placeholder="审核意见（可选）"
                  value={comments[q.id] ?? ""}
                  onChange={(e) =>
                    setComments({ ...comments, [q.id]: e.target.value })
                  }
                  aria-label={`审核意见：${q.videoBrief.contentAngle.title}`}
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === q.id}
                    onClick={() => decide(q.id, "APPROVED")}
                  >
                    {busyId === q.id ? (
                      <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />
                    ) : (
                      <Check strokeWidth={1.5} aria-hidden />
                    )}
                    通过
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === q.id}
                    onClick={() => decide(q.id, "CHANGES_REQUESTED")}
                  >
                    <RotateCw strokeWidth={1.5} aria-hidden />
                    要求修改
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyId === q.id}
                    onClick={() => decide(q.id, "REJECTED")}
                  >
                    <X strokeWidth={1.5} aria-hidden />
                    驳回
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
