import type { Locale } from "@/i18n/config";
import { getGrowthCopy, labelFor } from "@/i18n/growth-copy";
import { LeadTime } from "./lead-time";

export type PilotApplicationRow = {
  id: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  wechat: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  monthlyLeadSpend: string | null;
  message: string | null;
  source: string | null;
  createdAt: string;
};

/** 试点申请只读列表（仅超管）：公开首页与展位导入都落在这里。 */
export function PilotApplicationsTable({ locale, rows }: { locale: Locale; rows: PilotApplicationRow[] }) {
  const growth = getGrowthCopy(locale);
  const copy = growth.admin;
  if (rows.length === 0) {
    return <p className="x-panel px-5 py-8 text-body text-muted-foreground">{copy.pilotEmpty}</p>;
  }
  return (
    <div className="x-panel min-w-0 overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-meta">
        <thead>
          <tr className="border-b border-border">
            {[copy.pilotColumns.when, copy.pilotColumns.who, copy.pilotColumns.contact, copy.pilotColumns.business, copy.pilotColumns.source, copy.pilotColumns.message].map(
              (label) => (
                <th key={label} scope="col" className="x-label px-4 py-2.5 font-medium">
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-3 font-mono text-data tabular-nums text-muted-foreground">
                <LeadTime iso={row.createdAt} locale={locale} />
              </td>
              <td className="px-4 py-3">
                <p className="text-foreground">{row.company ?? row.name ?? "—"}</p>
                {row.company && row.name ? <p className="text-muted-foreground">{row.name}</p> : null}
              </td>
              <td className="space-y-0.5 px-4 py-3 font-mono text-data">
                {row.email ? <p className="break-all">{row.email}</p> : null}
                {row.phone ? <p>{row.phone}</p> : null}
                {row.whatsapp ? <p>WhatsApp {row.whatsapp}</p> : null}
                {row.wechat ? <p>{growth.pilotForm.wechat} {row.wechat}</p> : null}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {[row.industry, row.city].filter(Boolean).join(" · ") || "—"}
                {row.monthlyLeadSpend ? <p>{labelFor(growth.spend, row.monthlyLeadSpend)}</p> : null}
                {row.website ? <p className="break-all">{row.website}</p> : null}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-data text-muted-foreground">{row.source ?? "—"}</td>
              <td className="max-w-[28ch] px-4 py-3 text-muted-foreground">
                <p className="line-clamp-3" title={row.message ?? undefined}>
                  {row.message ?? "—"}
                </p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
