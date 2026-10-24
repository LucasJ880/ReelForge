"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, BadgeCheck, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusTick, type TickTone } from "@/components/exchange/status-tick";
import { stateTone } from "@/lib/exchange/state-vocab";
import type { Locale } from "@/i18n/config";
import { LEAD_STATUSES, fillGrowth, getGrowthCopy, labelFor, type LeadStatusKey } from "@/i18n/growth-copy";
import { cn } from "@/lib/utils";
import { NativeSelect } from "./form-fields";
import { leadMilestone } from "./lead-milestone";
import { LeadTime } from "./lead-time";
import { sendJson } from "./leads-api";

export type LeadRow = {
  id: string;
  source: string;
  name: string;
  phone: string | null;
  email: string | null;
  serviceInterest: string | null;
  preferredTime: string | null;
  selfReportedSource: string | null;
  message: string | null;
  status: LeadStatusKey;
  contactedAt: string | null;
  bookedAt: string | null;
  wonAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  trackedLink: { label: string; channel: string | null } | null;
};

/// 询盘状态记号：新询盘=青（当前要处理），跟进中=半圆，成交=实心绿，未成交=叉——都在状态词典里（lead 实体）。
export function leadStatusTone(status: LeadStatusKey): TickTone {
  return stateTone("lead", status);
}

const ROW_GRID = "lg:grid-cols-[8.5rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.8fr)_8rem_minmax(11rem,auto)]";

/**
 * 询盘列表：状态流转（服务端补时间戳）、核实、归档。每次改完刷新服务端读数。
 * 窄屏按卡片堆叠，宽屏对齐成台账列。
 */
export function LeadsBoard({ locale, leads }: { locale: Locale; leads: LeadRow[] }) {
  const growth = getGrowthCopy(locale);
  const copy = growth.leads;
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(leadId: string, body: Record<string, unknown>) {
    setBusyId(leadId);
    setError(null);
    const result = await sendJson(`/api/leads/${encodeURIComponent(leadId)}`, "PATCH", body);
    setBusyId(null);
    if (!result.ok) setError(result.reason === "conflict" ? copy.conflict : copy.actionFailed);
    router.refresh();
  }

  if (leads.length === 0) {
    return (
      <p data-route-state="empty" className="x-panel px-5 py-8 text-body text-muted-foreground">
        {copy.listEmpty}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : null}
      <div className="x-panel min-w-0 overflow-hidden">
        <div className={cn("hidden gap-4 border-b border-border px-4 py-2.5 lg:grid", ROW_GRID)} aria-hidden>
          {[copy.columns.when, copy.columns.who, copy.columns.service, copy.columns.source, copy.columns.status, copy.columns.actions].map(
            (label) => (
              <span key={label} className="x-label">
                {label}
              </span>
            ),
          )}
        </div>
        <ul className="divide-y divide-border">
          {leads.map((lead) => {
            const sourceLabel = labelFor(growth.sources, lead.source) ?? lead.source;
            const channel = lead.trackedLink?.channel ? labelFor(growth.channels, lead.trackedLink.channel) : null;
            const selfReported = labelFor(growth.selfReported, lead.selfReportedSource);
            /// 里程碑只写当前状态仍然成立的那一步（改回未成交后不再挂「已成交」）
            const milestone = leadMilestone(lead);
            const busy = busyId === lead.id;
            return (
              <li key={lead.id} className={cn("grid gap-x-4 gap-y-2 px-4 py-3.5", ROW_GRID)} aria-busy={busy || undefined}>
                <div className="flex flex-col gap-0.5 font-mono text-data tabular-nums text-muted-foreground">
                  <LeadTime iso={lead.createdAt} locale={locale} />
                  {milestone ? (
                    <span className={milestone.status === "WON" ? "text-success" : undefined}>
                      {growth.statuses[milestone.status]} <LeadTime iso={milestone.at} locale={locale} />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-body font-medium">{lead.name}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 font-mono tabular-nums hover:text-foreground">
                        <Phone className="size-3.5" strokeWidth={1.5} aria-hidden />
                        {lead.phone}
                      </a>
                    ) : null}
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="inline-flex min-w-0 items-center gap-1 hover:text-foreground">
                        <Mail className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                        <span className="truncate">{lead.email}</span>
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="min-w-0 space-y-1 text-meta">
                  {lead.serviceInterest ? <p className="truncate text-foreground">{lead.serviceInterest}</p> : null}
                  {lead.preferredTime ? (
                    <p className="text-muted-foreground">{labelFor(growth.preferredTimes, lead.preferredTime)}</p>
                  ) : null}
                  {lead.message ? (
                    <p className="line-clamp-2 text-muted-foreground" title={lead.message}>
                      {lead.message}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0 space-y-1 text-meta">
                  <p className="text-foreground">
                    {sourceLabel}
                    {channel ? <span className="text-muted-foreground"> · {channel}</span> : null}
                  </p>
                  {lead.trackedLink ? <p className="truncate text-muted-foreground">{lead.trackedLink.label}</p> : null}
                  {selfReported ? (
                    <p className="text-muted-foreground">{fillGrowth(copy.selfReported, { source: selfReported })}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <StatusTick entity="lead" state={lead.status} locale={locale} />
                  {lead.verifiedAt ? (
                    <span className="inline-flex items-center gap-1 font-mono text-data uppercase tracking-wide text-success">
                      <BadgeCheck className="size-3.5" strokeWidth={1.5} aria-hidden />
                      {copy.verified}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <NativeSelect
                    aria-label={`${copy.moveTo} · ${lead.name}`}
                    value=""
                    disabled={busy}
                    onChange={(event) => {
                      if (event.target.value) void patch(lead.id, { status: event.target.value });
                    }}
                    className="h-8 w-auto min-w-28 text-meta"
                  >
                    <option value="">{copy.moveTo}…</option>
                    {LEAD_STATUSES.filter((status) => status !== lead.status).map((status) => (
                      <option key={status} value={status}>
                        {growth.statuses[status]}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    className="h-8"
                    onClick={() => void patch(lead.id, { verified: !lead.verifiedAt })}
                  >
                    {lead.verifiedAt ? copy.unmarkVerified : copy.markVerified}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy}
                    className="size-8"
                    aria-label={`${copy.archive} · ${lead.name}`}
                    title={copy.archive}
                    onClick={() => {
                      if (window.confirm(copy.archiveConfirm)) void patch(lead.id, { archived: true });
                    }}
                  >
                    <Archive aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
