import type { ReactNode } from "react";
import { revalidatePath } from "next/cache";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  TEST: "测试线索",
} as const;

const LEAD_STATUS_TONES = {
  NEW: "info",
  CONTACTED: "warning",
  DEMO_BOOKED: "success",
  NOT_FIT: "neutral",
  TEST: "neutral",
} as const;

const LEAD_STATUS_OPTIONS = [
  { value: "NEW", label: "new" },
  { value: "CONTACTED", label: "contacted" },
  { value: "DEMO_BOOKED", label: "demo_booked" },
  { value: "NOT_FIT", label: "not_fit" },
  { value: "TEST", label: "test" },
] as const;

type LeadStatus = (typeof LEAD_STATUS_OPTIONS)[number]["value"];

const MANUAL_PROOF_SIGNALS = [
  ["真实素材 demo runs", "4", "手动维护：已完成或可复现的演示轮次"],
  ["已渲染视频", "6", "手动维护：可展示的 9:16 MP4 输出"],
  ["愿意上传素材", "5", "手动维护：明确愿意提供真实素材试跑"],
  ["价格正向对话", "3", "手动维护：表达预算、付费意愿或采购路径"],
] as const;

export default async function DemoLeadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ showHidden?: string }>;
}) {
  const params = await searchParams;
  const showHidden = params?.showHidden === "1";
  const leads = await db.realFootageDemoLead.findMany({
    where: showHidden ? undefined : { hiddenAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const hiddenTestLeadCount = await db.realFootageDemoLead.count({
    where: { status: "TEST", hiddenAt: { not: null } },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Demo 线索"
        description={`Real-footage ads public demo waitlist，共 ${leads.length} 条最近提交${
          showHidden ? "（含隐藏测试线索）" : ""
        }`}
      />

      <Card size="sm" className="flex flex-col gap-3 px-4 text-body text-muted-foreground md:flex-row md:items-center md:justify-between">
        <span>
          轻量管理：更新状态、把测试提交标记为 test，并隐藏或删除 test 线索。
        </span>
        <a
          href={showHidden ? "/demo-leads" : "/demo-leads?showHidden=1"}
          className="text-primary hover:underline"
        >
          {showHidden
            ? "隐藏测试线索"
            : `显示隐藏测试线索${hiddenTestLeadCount ? ` (${hiddenTestLeadCount})` : ""}`}
        </a>
      </Card>

      <Card className="p-6">
        <div className="mb-6">
          <p className="text-meta font-semibold uppercase tracking-[0.16em] text-primary">
            Proof dashboard
          </p>
          <h2 className="mt-2 font-heading text-title">
            投资人 / 客户验证信号
          </h2>
          <p className="mt-2 text-body text-muted-foreground">
            Lead 数来自数据库，其余早期 traction 指标可先手动维护，直到 trial
            workflow 稳定后再自动化。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <ProofMetric
            label="Leads"
            value={String(leads.length)}
            detail="公开 demo waitlist 最近 100 条"
          />
          {MANUAL_PROOF_SIGNALS.map(([label, value, detail]) => (
            <ProofMetric
              key={label}
              label={label}
              value={value}
              detail={detail}
            />
          ))}
        </div>
      </Card>

      {leads.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-body text-muted-foreground">
            暂无 waitlist 提交。分享 /demo/real-footage-ads 后，新的线索会出现在这里。
          </p>
        </Card>
      ) : (
        <Card>
          <div
            className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            role="region"
            aria-label="Demo 线索列表"
            tabIndex={0}
          >
            <table className="min-w-240 w-full text-left text-body">
              <thead className="border-b border-border bg-secondary text-meta text-muted-foreground">
                <tr>
                  <Th>姓名</Th>
                  <Th>邮箱</Th>
                  <Th>业务类型</Th>
                  <Th>月视频量</Th>
                  <Th>痛点</Th>
                  <Th>状态</Th>
                  <Th>提交时间</Th>
                  <Th>管理</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-border last:border-0"
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
                      {lead.hiddenAt ? (
                        <p className="mt-2 text-meta text-muted-foreground">
                          已隐藏：{formatDate(lead.hiddenAt)}
                        </p>
                      ) : null}
                    </Td>
                    <Td>{formatDate(lead.createdAt)}</Td>
                    <Td>
                      <div className="grid min-w-44 gap-2">
                        <form action={updateLeadStatus} className="flex gap-2">
                          <input type="hidden" name="id" value={lead.id} />
                          <select
                            name="status"
                            defaultValue={lead.status}
                            className="h-10 min-w-32 rounded-(--radius-md) border border-input bg-card px-3 text-meta text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {LEAD_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="submit"
                            variant="outline"
                          >
                            更新
                          </Button>
                        </form>

                        {lead.status === "TEST" ? (
                          <div className="flex flex-wrap gap-2">
                            {!lead.hiddenAt ? (
                              <form action={hideTestLead}>
                                <input type="hidden" name="id" value={lead.id} />
                                <Button
                                  type="submit"
                                  variant="outline"
                                >
                                  隐藏
                                </Button>
                              </form>
                            ) : null}
                            <form action={deleteTestLead}>
                              <input type="hidden" name="id" value={lead.id} />
                              <Button
                                type="submit"
                                variant="destructive"
                              >
                                删除测试
                              </Button>
                            </form>
                          </div>
                        ) : null}
                      </div>
                    </Td>
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

async function updateLeadStatus(formData: FormData) {
  "use server";

  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");

  if (!id || !isLeadStatus(status)) {
    return;
  }

  await db.realFootageDemoLead.update({
    where: { id },
    data: {
      status,
      hiddenAt: status === "TEST" ? undefined : null,
    },
  });
  revalidatePath("/demo-leads");
}

async function hideTestLead(formData: FormData) {
  "use server";

  const id = String(formData.get("id") || "");
  if (!id) {
    return;
  }

  await db.realFootageDemoLead.updateMany({
    where: { id, status: "TEST" },
    data: { hiddenAt: new Date() },
  });
  revalidatePath("/demo-leads");
}

async function deleteTestLead(formData: FormData) {
  "use server";

  const id = String(formData.get("id") || "");
  if (!id) {
    return;
  }

  await db.realFootageDemoLead.deleteMany({
    where: { id, status: "TEST" },
  });
  revalidatePath("/demo-leads");
}

function isLeadStatus(status: string): status is LeadStatus {
  return LEAD_STATUS_OPTIONS.some((option) => option.value === status);
}

function ProofMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-l-2 border-primary pl-4">
      <p className="font-heading text-title text-primary">{value}</p>
      <p className="mt-1 text-body font-medium">{label}</p>
      <p className="mt-2 text-meta text-muted-foreground">{detail}</p>
    </div>
  );
}
