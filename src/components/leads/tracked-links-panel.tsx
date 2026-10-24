"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2Off, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import { TRACKED_LINK_CHANNELS, getGrowthCopy, labelFor, type TrackedLinkChannel } from "@/i18n/growth-copy";
import { Field, FormAlert, NativeSelect } from "./form-fields";
import { sendJson } from "./leads-api";

export type TrackedLinkRow = {
  id: string;
  code: string;
  label: string;
  channel: string | null;
  destinationUrl: string | null;
  clickCount: number;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * 追踪链接：按渠道手工建、复制短链、停用（归档）。点击数只算真人（爬虫与 HEAD 不计）。
 * node_modules 里没有二维码库：二维码先给链接本身，交给印刷或手机生成。
 */
export function TrackedLinksPanel({
  locale,
  baseUrl,
  enabled,
  links,
}: {
  locale: Locale;
  baseUrl: string;
  enabled: boolean;
  links: TrackedLinkRow[];
}) {
  const growth = getGrowthCopy(locale);
  const copy = growth.leads;
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [channel, setChannel] = useState<TrackedLinkChannel>("ig_bio");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!label.trim()) return setNotice({ tone: "error", text: growth.leadForm.invalid });
    setBusy(true);
    const result = await sendJson("/api/leads/links", "POST", {
      label,
      channel,
      destinationUrl: destination.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      return setNotice({
        tone: "error",
        text:
          result.reason === "destination_not_allowed"
            ? copy.destinationRejected
            : result.reason === "lead_page_disabled"
              ? copy.linksDisabled
              : copy.actionFailed,
      });
    }
    setLabel("");
    setDestination("");
    setNotice({ tone: "info", text: copy.linkCreated });
    router.refresh();
  }

  async function archive(linkId: string) {
    if (!window.confirm(copy.linkArchiveConfirm)) return;
    const result = await sendJson(`/api/leads/links/${encodeURIComponent(linkId)}`, "PATCH", { archived: true });
    if (!result.ok) setNotice({ tone: "error", text: copy.actionFailed });
    router.refresh();
  }

  async function copyLink(link: TrackedLinkRow) {
    try {
      await navigator.clipboard.writeText(`${baseUrl}/t/${link.code}`);
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 1800);
    } catch {
      /// 剪贴板被拒（非 https、权限）：链接本身就显示在行里，可手动复制
    }
  }

  return (
    <div className="x-panel min-w-0 space-y-4 p-5">
      {links.length === 0 ? (
        <p className="text-meta text-muted-foreground">{copy.linksEmpty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-(--radius-md) border border-border">
          {links.map((link) => {
            const url = `${baseUrl}/t/${link.code}`;
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-body font-medium">
                    {link.label}
                    <span className="ml-2 text-meta font-normal text-muted-foreground">{labelFor(growth.channels, link.channel)}</span>
                  </p>
                  <p className="truncate font-mono text-data text-muted-foreground" title={url}>
                    {url}
                  </p>
                  <p className="text-meta text-tertiary">→ {link.destinationUrl ? hostOf(link.destinationUrl) : copy.linkToPage}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-right">
                    <span className="block font-mono text-body tabular-nums">{link.clickCount}</span>
                    <span className="x-label">{copy.linkClicks}</span>
                  </span>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => void copyLink(link)}>
                    <Copy aria-hidden />
                    {copiedId === link.id ? copy.linkCopied : copy.linkCopy}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="size-8"
                    aria-label={`${copy.linkArchive} · ${link.label}`}
                    title={copy.linkArchive}
                    onClick={() => void archive(link.id)}
                  >
                    <Link2Off aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {enabled ? (
        <form onSubmit={create} aria-label={copy.linkCreate} className="space-y-4 border-t border-border pt-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="link-label" label={copy.linkLabel}>
              <Input id="link-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={copy.linkLabelPlaceholder} maxLength={60} />
            </Field>
            <Field id="link-channel" label={copy.linkChannel}>
              <NativeSelect id="link-channel" value={channel} onChange={(event) => setChannel(event.target.value as TrackedLinkChannel)}>
                {TRACKED_LINK_CHANNELS.map((key) => (
                  <option key={key} value={key}>
                    {growth.channels[key]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="link-destination" label={copy.linkDestination} hint={copy.linkDestinationHint}>
            <Input
              id="link-destination"
              type="url"
              inputMode="url"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="https://"
              maxLength={500}
            />
          </Field>
          {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline" disabled={busy}>
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {copy.linkCreate}
            </Button>
            <p className="text-meta text-muted-foreground">{copy.qrNote}</p>
          </div>
        </form>
      ) : (
        <>
          {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
          <p className="border-t border-border pt-4 text-meta text-muted-foreground">{copy.linksDisabled}</p>
        </>
      )}
    </div>
  );
}
