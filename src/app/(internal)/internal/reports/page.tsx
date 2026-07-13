import { db } from "@/lib/db";
import { PageHeader } from "@/components/features/page-header";
import { Badge } from "@/components/ui/badge";
import { ReportActions } from "@/components/internal/report-actions";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const reports = await db.contentReport.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { reporter: { select: { email: true } } } });
  return <div className="space-y-6">
    <PageHeader title="内容举报" description={`${reports.filter((report) => report.status === "OPEN").length} 条待处理 · 操作写入审计记录`} />
    {reports.length === 0 ? <div className="rounded-(--radius-lg) border border-border bg-card p-8 text-body text-muted-foreground">当前没有举报。客户提交后会在这里进入队列。</div> : <div className="space-y-3">
      {reports.map((report) => <article key={report.id} className="space-y-3 rounded-(--radius-lg) border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-meta text-muted-foreground">{report.id} · {report.createdAt.toISOString()}</p><h2 className="mt-1 font-heading text-title font-semibold">{report.reason}</h2></div><Badge variant={report.status === "OPEN" ? "destructive" : report.status === "ACTIONED" ? "success" : "secondary"}>{report.status}</Badge></div>
        <p className="text-body">{report.details || "未提供补充说明"}</p>
        <p className="font-mono text-meta text-muted-foreground">BRIEF {report.targetBriefId} · {report.reporter.email}</p>
        {report.resolutionNote ? <p className="text-meta text-muted-foreground">处理记录：{report.resolutionNote}</p> : null}
        <ReportActions reportId={report.id} disabled={report.status === "ACTIONED" || report.status === "DISMISSED"} />
      </article>)}
    </div>}
  </div>;
}
