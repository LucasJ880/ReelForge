"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowRight, Briefcase, Check, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
  const { update: updateSession } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const Icon = persona === "BUSINESS" ? Briefcase : Sparkles;

  async function handleContinue() {
    setError("");
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
      /// 刷新 JWT 里的 userType（auth.ts jwt callback trigger=update）
      await updateSession();
      router.push(persona === "BUSINESS" ? "/business" : "/personal");
      router.refresh();
    } catch (err) {
      console.error("[persona] failed to set userType:", err);
      setError("暂时无法保存选择，请稍后再试。");
      setSubmitting(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <Badge variant="secondary">
          <Icon strokeWidth={1.5} aria-hidden />
          {title}
        </Badge>
        <CardTitle className="mt-3">{tagline}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="space-y-3 text-body">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-3">
              <Check
                className="mt-1 size-4 shrink-0 text-success"
                strokeWidth={1.5}
                aria-hidden
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="mt-4 text-meta text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        {isAuthed ? (
          <Button
            type="button"
            disabled={submitting}
            onClick={handleContinue}
            className="w-full"
          >
            {submitting ? (
              <Loader2
                className="animate-spin motion-reduce:animate-none"
                strokeWidth={1.5}
                aria-hidden
              />
            ) : null}
            Continue as {title}
            {!submitting ? <ArrowRight strokeWidth={1.5} aria-hidden /> : null}
          </Button>
        ) : (
          <Button render={<Link href={ctaHref ?? "/login"} />} className="w-full">
            {ctaLabel ?? `Sign in as ${title}`}
            <ArrowRight strokeWidth={1.5} aria-hidden />
          </Button>
        )}
        {secondaryNote ? (
          <p className="text-meta text-muted-foreground">{secondaryNote}</p>
        ) : null}
      </CardFooter>
    </Card>
  );
}
