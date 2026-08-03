"use client";

import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n/useTranslation";

/**
 * 链接起片（PRD O1：商品链接 P0 输入）。
 * 贴商品页链接 → 抓事实（Shopify JSON → 直抓 → Firecrawl 兜底）→ 预填提示词。
 * 有独立站的商家走这条；没有的继续用一句话描述，互不阻塞。
 */

const COPY = {
  "zh-CN": {
    placeholder: "有商品页？贴链接自动填（Shopify / 通用商品页）",
    action: "抓取",
    fetching: "抓取中…",
    done: "已按「{title}」预填，可继续修改",
    doneNoTitle: "已按页面内容预填，可继续修改",
    errorFallback: "抓取失败，请检查链接后重试",
  },
  "en-US": {
    placeholder: "Have a product page? Paste the link to prefill (Shopify / generic)",
    action: "Fetch",
    fetching: "Fetching…",
    done: "Prefilled from “{title}” — edit freely",
    doneNoTitle: "Prefilled from the page — edit freely",
    errorFallback: "Fetch failed. Check the link and retry.",
  },
} as const;

export function ProductLinkPrefill({
  disabled,
  onPrefill,
}: {
  disabled?: boolean;
  onPrefill: (promptText: string) => void;
}) {
  const { locale } = useTranslation();
  const copy = COPY[locale === "en-US" ? "en-US" : "zh-CN"];
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function handleFetch() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/product-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok: true; promptText: string; facts: { title: string | null } }
        | { ok: false; error?: string }
        | null;
      if (!payload?.ok) {
        setNotice({
          tone: "error",
          text: payload && "error" in payload && payload.error ? payload.error : copy.errorFallback,
        });
        return;
      }
      onPrefill(payload.promptText);
      setNotice({
        tone: "ok",
        text: payload.facts.title
          ? copy.done.replace("{title}", payload.facts.title.slice(0, 30))
          : copy.doneNoTitle,
      });
      setUrl("");
    } catch {
      setNotice({ tone: "error", text: copy.errorFallback });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="url"
          inputMode="url"
          value={url}
          placeholder={copy.placeholder}
          disabled={disabled || busy}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && url.trim()) {
              event.preventDefault();
              void handleFetch();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || !url.trim()}
          onClick={() => void handleFetch()}
          className="shrink-0"
        >
          {busy ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Link2 aria-hidden />
          )}
          {busy ? copy.fetching : copy.action}
        </Button>
      </div>
      {notice ? (
        <p className={`text-meta ${notice.tone === "error" ? "text-danger" : "text-muted-foreground"}`}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
