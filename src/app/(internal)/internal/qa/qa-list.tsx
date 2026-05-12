"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, X, RotateCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
      <Card className="p-8 text-center text-sm text-muted-foreground">
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
            <CardContent className="grid gap-4 pt-4 md:grid-cols-[300px_1fr]">
              {q.videoBrief.finalVideoUrl ? (
                <video
                  src={q.videoBrief.finalVideoUrl}
                  controls
                  className="w-full rounded"
                />
              ) : (
                <div className="flex aspect-[9/16] items-center justify-center rounded bg-secondary/40 text-xs text-muted-foreground">
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
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {q.videoBrief.contentAngle.round.deliveryOrder.title} · 第{" "}
                    {q.videoBrief.contentAngle.round.roundIndex} 轮
                  </div>
                </div>

                {q.reviewerComment && (
                  <p className="rounded bg-secondary/40 p-2 text-xs text-muted-foreground">
                    {q.reviewerComment}
                  </p>
                )}

                {issues.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {issues.map((i, idx) => (
                      <li key={idx}>{i}</li>
                    ))}
                  </ul>
                )}

                <textarea
                  rows={2}
                  placeholder="审核意见（可选）"
                  value={comments[q.id] ?? ""}
                  onChange={(e) =>
                    setComments({ ...comments, [q.id]: e.target.value })
                  }
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                />

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === q.id}
                    onClick={() => decide(q.id, "APPROVED")}
                  >
                    {busyId === q.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    通过
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === q.id}
                    onClick={() => decide(q.id, "CHANGES_REQUESTED")}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    要求修改
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyId === q.id}
                    onClick={() => decide(q.id, "REJECTED")}
                  >
                    <X className="h-3.5 w-3.5" />
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
