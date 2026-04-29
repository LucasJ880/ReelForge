import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge } from "@/components/features/status-badge";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LEAD_STATUS_LABELS = {
  NEW: "新线索",
  CONTACTED: "已联系",
  DEMO_BOOKED: "已约 demo",
  NOT_FIT: "暂不匹配",
} as const;

const LEAD_STATUS_TONES = {
  NEW: "info",
  CONTACTED: "warning",
  DEMO_BOOKED: "success",
  NOT_FIT: "neutral",
} as const;

export default async function DemoLeadsPage() {
  const leads = await db.realFootageDemoLead.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <PageHeader
        title="Demo 线索"
        description={`Real-footage ads public demo waitlist，共 ${leads.length} 条最近提交`}
      />

      {leads.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            暂无 waitlist 提交。分享 /demo/real-footage-ads 后，新的线索会出现在这里。
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
                <tr>
                  <Th>姓名</Th>
                  <Th>邮箱</Th>
                  <Th>业务类型</Th>
                  <Th>月视频量</Th>
                  <Th>痛点</Th>
                  <Th>状态</Th>
                  <Th>提交时间</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-border/70 last:border-0"
                  >
                    <Td>
                      <span className="font-medium text-foreground">{lead.name}</span>
                    </Td>
                    <Td>
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-primary hover:underline"
                      >
                        {lead.email}
                      </a>
                    </Td>
                    <Td>{lead.businessType}</Td>
                    <Td>{lead.monthlyVolume}</Td>
                    <Td>
                      <p className="max-w-md whitespace-pre-wrap leading-6">
                        {lead.painPoint}
                      </p>
                    </Td>
                    <Td>
                      <StatusBadge tone={LEAD_STATUS_TONES[lead.status]}>
                        {LEAD_STATUS_LABELS[lead.status]}
                      </StatusBadge>
                    </Td>
                    <Td>{formatDate(lead.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td className="align-top px-4 py-4 text-muted-foreground">{children}</td>;
}
