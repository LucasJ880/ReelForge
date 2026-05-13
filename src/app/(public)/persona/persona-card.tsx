"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Sparkles, Briefcase } from "lucide-react";

interface PersonaCardProps {
  persona: "BUSINESS" | "PERSONAL";
  title: string;
  tagline: string;
  description: string;
  bullets: string[];
  isAuthed: boolean;
  ctaHref?: string;
  /// 自定义未登录态的按钮文案；默认是 "Sign in as {title}"
  ctaLabel?: string;
  /// 卡片底部的小字补充说明（如 "invite-only" / "free to start"）
  secondaryNote?: string;
}

export function PersonaCard({
  persona,
  title,
  tagline,
  description,
  bullets,
  isAuthed,
  ctaHref,
  ctaLabel,
  secondaryNote,
}: PersonaCardProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const Icon = persona === "BUSINESS" ? Briefcase : Sparkles;

  async function handleContinue() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/persona", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      router.push(persona === "BUSINESS" ? "/business" : "/personal");
      router.refresh();
    } catch (err) {
      console.error("[persona] failed to set userType:", err);
      setSubmitting(false);
    }
  }

  return (
    <div className="group rounded-xl border border-white/10 bg-card p-7 hover:border-white/20 hover:bg-card/80 transition-colors">
      <div className="flex items-center gap-3 text-foreground">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">
        {tagline}
      </h2>
      <p className="mt-3 text-sm text-muted-foreground">{description}</p>

      <ul className="mt-6 space-y-2 text-sm">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span className="text-muted-foreground mt-1">·</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-7 space-y-2">
        {isAuthed ? (
          <button
            type="button"
            disabled={submitting}
            onClick={handleContinue}
            className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-60"
          >
            Continue as {title}
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <Link
            href={ctaHref ?? "/login"}
            className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            {ctaLabel ?? `Sign in as ${title}`}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
        {secondaryNote ? (
          <p className="text-[11px] text-muted-foreground">{secondaryNote}</p>
        ) : null}
      </div>
    </div>
  );
}
