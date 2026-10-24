"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusTick } from "@/components/exchange/status-tick";
import type { Locale } from "@/i18n/config";
import { getGrowthCopy } from "@/i18n/growth-copy";
import { Field, FormAlert } from "./form-fields";
import { sendJson } from "./leads-api";

export type AdminWorkspaceRow = {
  id: string;
  name: string;
  ownerEmail: string;
  publicSlug: string | null;
  leadPageEnabled: boolean;
  allowedHosts: string[];
};

/**
 * 超管面板：按账号邮箱找到工作区 → 开通 / 关闭询盘页、设地址与允许跳转的 https 商家域名。
 * 服务端再校验一遍（保留词、格式、唯一、域名），这里只负责把原因说成人话。
 */
export function LeadAdminPanel({ locale, active }: { locale: Locale; active: AdminWorkspaceRow[] }) {
  const copy = getGrowthCopy(locale).admin;
  const leads = getGrowthCopy(locale).leads;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [target, setTarget] = useState<AdminWorkspaceRow | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState("");
  const [hosts, setHosts] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  function load(row: AdminWorkspaceRow) {
    setTarget(row);
    setEnabled(row.leadPageEnabled);
    setSlug(row.publicSlug ?? "");
    setHosts(row.allowedHosts.join("\n"));
    setNotice(null);
  }

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!email.trim()) return;
    setBusy(true);
    const result = await sendJson<{ workspace: AdminWorkspaceRow }>(
      `/api/leads/admin/workspaces?email=${encodeURIComponent(email.trim())}`,
      "GET",
    );
    setBusy(false);
    if (!result.ok) {
      setTarget(null);
      return setNotice({ tone: "error", text: copy.notFound });
    }
    load(result.data.workspace);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    setNotice(null);
    setBusy(true);
    const result = await sendJson<{ workspace: AdminWorkspaceRow }>(
      `/api/leads/admin/workspaces/${encodeURIComponent(target.id)}`,
      "PUT",
      {
        enabled,
        slug: slug.trim() || null,
        allowedHosts: hosts
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      },
    );
    setBusy(false);
    if (!result.ok) {
      const text =
        result.reason === "slug_taken"
          ? copy.slugTaken
          : result.reason === "slug_reserved"
            ? copy.slugReserved
            : result.reason === "slug_invalid"
              ? copy.slugInvalid
              : result.reason === "slug_required"
                ? copy.slugRequired
                : result.reason === "slug_hosts_invalid"
                  ? copy.hostsInvalid
                  : leads.actionFailed;
      return setNotice({ tone: "error", text });
    }
    setNotice({ tone: "info", text: copy.saved });
    router.refresh();
  }

  return (
    <div className="x-panel min-w-0 space-y-5 p-5">
      <form onSubmit={lookup} className="flex flex-wrap items-end gap-3" aria-label={copy.lookup}>
        <Field id="admin-email" label={copy.lookupLabel} className="min-w-56 flex-1">
          <Input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
        </Field>
        <Button type="submit" variant="outline" disabled={busy}>
          {busy && !target ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Search aria-hidden />}
          {copy.lookup}
        </Button>
      </form>

      {active.length ? (
        <div className="space-y-2">
          <p className="x-label">{copy.activeTitle}</p>
          <ul className="flex flex-wrap gap-2">
            {active.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => load(row)}
                  className="inline-flex items-center gap-2 rounded-(--radius-md) border border-border px-2.5 py-1 text-meta hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <StatusTick tone={row.leadPageEnabled ? "live" : "void"} label={row.publicSlug ?? "—"} className="normal-case" />
                  <span className="text-muted-foreground">{row.ownerEmail}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">{copy.activeEmpty}</p>
      )}

      {target ? (
        <form onSubmit={save} className="space-y-4 border-t border-border pt-5" aria-label={copy.enableTitle} noValidate>
          <p className="text-meta text-muted-foreground">
            <span className="text-foreground">{target.name}</span> · {target.ownerEmail}
          </p>
          <label htmlFor="admin-enabled" className="flex items-center gap-3 text-body">
            <input
              id="admin-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="size-4 accent-(--accent)"
            />
            {copy.enabled}
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="admin-slug" label={copy.slug} hint={copy.slugHint}>
              <Input
                id="admin-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                maxLength={64}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field id="admin-hosts" label={copy.allowedHosts} hint={copy.allowedHostsHint}>
              <Textarea id="admin-hosts" value={hosts} onChange={(event) => setHosts(event.target.value)} className="min-h-20 font-mono" />
            </Field>
          </div>
          {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {copy.save}
          </Button>
        </form>
      ) : notice ? (
        <FormAlert tone={notice.tone}>{notice.text}</FormAlert>
      ) : null}
    </div>
  );
}
