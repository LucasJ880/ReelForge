import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import type { QuoteStat } from "@/components/exchange/quote-header";
import { WorkspacePage } from "@/components/exchange/workspace-page";
import { SectionHead } from "@/components/exchange/section-head";
import { Button } from "@/components/ui/button";
import { LeadsBoard, type LeadRow } from "@/components/leads/leads-board";
import { ManualLeadForm } from "@/components/leads/manual-lead-form";
import { TrackedLinksPanel } from "@/components/leads/tracked-links-panel";
import { LeadPageSettings } from "@/components/leads/lead-page-settings";
import { LeadAdminPanel } from "@/components/leads/lead-admin-panel";
import { PilotApplicationsTable } from "@/components/leads/pilot-applications-table";
import { getServerLocale } from "@/i18n/server";
import { fillGrowth, getGrowthCopy, labelFor } from "@/i18n/growth-copy";
import {
  listLeadPageWorkspaces,
  listPilotApplications,
  loadLeadsDashboard,
  parseLeadPageConfig,
} from "@/lib/services/lead-service";
import { leadPagePath, publicBaseUrl } from "@/lib/services/tracked-link-service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = getGrowthCopy(await getServerLocale()).leads;
  return { title: `${copy.title} · Aivora` };
}

/**
 * 工作台「询盘」（计划 6.4）：读数墙只放询盘 / 点击 / 来源（真实数字，零就写零）；
 * 列表 + 状态流转 + 手工登记；追踪链接管理；询盘页设置（地址与开通只读）。
 * 超管额外看到试点申请只读列表与询盘页开通面板。
 */
export default async function LeadsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/leads");
  const isSuperAdmin = session.user.role === "SUPER_ADMIN";

  const [locale, workspace, requestHeaders] = await Promise.all([
    getServerLocale(),
    db.workspace.findUnique({
      where: { ownerId: session.user.id },
      select: { id: true, publicSlug: true, leadPageEnabled: true, leadPageConfig: true, leadPageRequestedAt: true },
    }),
    headers(),
  ]);
  if (!workspace) throw new Error("默认 Workspace 不存在");

  const [dashboard, pilotApplications, activePages] = await Promise.all([
    loadLeadsDashboard(workspace.id),
    isSuperAdmin ? listPilotApplications(100) : Promise.resolve([]),
    isSuperAdmin ? listLeadPageWorkspaces() : Promise.resolve([]),
  ]);

  const growth = getGrowthCopy(locale);
  const copy = growth.leads;
  const baseUrl = publicBaseUrl(requestHeaders);
  const config = parseLeadPageConfig(workspace.leadPageConfig);
  const live = workspace.leadPageEnabled && Boolean(workspace.publicSlug);

  const topSource = dashboard.topSource;
  const topSourceLabel = topSource
    ? topSource.key.startsWith("channel:")
      ? labelFor(growth.channels, topSource.key.slice("channel:".length))
      : labelFor(growth.sources, topSource.key)
    : null;
  const stats: QuoteStat[] = [
    {
      label: copy.inquiries7,
      value: dashboard.inquiries7,
      caption: fillGrowth(copy.inquiriesCaption, { n: dashboard.inquiries30 }),
      tone: dashboard.inquiries7 > 0 ? "filled" : "neutral",
    },
    {
      label: copy.clicks7,
      value: dashboard.clicks7,
      caption: fillGrowth(copy.clicksCaption, { n: dashboard.clicks30 }),
    },
    {
      label: copy.topSource,
      value: topSourceLabel ?? "—",
      caption: topSource
        ? fillGrowth(copy.topSourceCaption, {
            n: topSource.count,
            pct: Math.round((topSource.count / topSource.total) * 100),
          })
        : copy.topSourceEmpty,
    },
  ];

  const leads: LeadRow[] = dashboard.leads.map((lead) => ({
    ...lead,
    contactedAt: lead.contactedAt?.toISOString() ?? null,
    bookedAt: lead.bookedAt?.toISOString() ?? null,
    wonAt: lead.wonAt?.toISOString() ?? null,
    verifiedAt: lead.verifiedAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
  }));

  return (
    <WorkspacePage
      nav="leads"
      locale={locale}
      testId="leads-page"
      subtitle={copy.subtitle}
      primaryAction={null}
      secondaryActions={
        live && workspace.publicSlug ? (
          <Button
            render={<a href={leadPagePath(workspace.publicSlug)} target="_blank" rel="noreferrer" />}
            variant="outline"
          >
            {copy.openPage}
            <ExternalLink aria-hidden />
          </Button>
        ) : undefined
      }
      readingsLabel={copy.statsLabel}
      readings={stats}
      scope={copy.scope}
    >

      <section aria-label={copy.listTitle} className="space-y-3">
        <SectionHead title={copy.listTitle} count={leads.length} hint={copy.listHint} />
        <LeadsBoard locale={locale} leads={leads} />
      </section>

      <div className="grid min-w-0 gap-10 xl:grid-cols-2">
        <section aria-label={copy.manualTitle} className="min-w-0 space-y-3">
          <SectionHead title={copy.manualTitle} hint={copy.manualHint} />
          <ManualLeadForm locale={locale} />
        </section>
        <section aria-label={copy.linksTitle} className="min-w-0 space-y-3">
          <SectionHead title={copy.linksTitle} count={dashboard.links.length} hint={copy.linksHint} />
          <TrackedLinksPanel locale={locale} baseUrl={baseUrl} enabled={live} links={dashboard.links} />
        </section>
      </div>

      <section aria-label={copy.pageTitle} className="space-y-3">
        <SectionHead title={copy.pageTitle} />
        <LeadPageSettings
          locale={locale}
          baseUrl={baseUrl}
          slug={workspace.publicSlug}
          enabled={live}
          requestedAt={workspace.leadPageRequestedAt?.toISOString() ?? null}
          display={{
            businessName: config.businessName ?? "",
            headline: config.headline ?? "",
            intro: config.intro ?? "",
            services: config.services ?? [],
            phone: config.phone ?? "",
            region: config.region ?? "",
            locale: config.locale ?? "",
          }}
        />
      </section>

      {isSuperAdmin ? (
        <>
          <section aria-label={growth.admin.pilotTitle} className="space-y-3">
            <SectionHead title={growth.admin.pilotTitle} count={pilotApplications.length} hint={growth.admin.pilotHint} />
            <PilotApplicationsTable
              locale={locale}
              rows={pilotApplications.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))}
            />
          </section>
          <section aria-label={growth.admin.enableTitle} className="space-y-3">
            <SectionHead title={growth.admin.enableTitle} hint={growth.admin.enableHint} />
            <LeadAdminPanel locale={locale} active={activePages} />
          </section>
        </>
      ) : null}
    </WorkspacePage>
  );
}
