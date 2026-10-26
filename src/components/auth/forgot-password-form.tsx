"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FormAlert } from "@/components/leads/form-fields";
import { useTranslation } from "@/i18n/useTranslation";
import { getPasswordResetCopy, type PasswordResetRequestErrorCode } from "@/i18n/password-reset-copy";

const ERROR_CODES = new Set<string>([
  "INVALID_EMAIL",
  "RATE_LIMITED",
  "INVALID_INPUT",
] satisfies PasswordResetRequestErrorCode[]);

type Phase = "form" | "sent" | "unavailable";

/**
 * 忘记密码（/forgot-password）。提交后无论邮箱是否注册都给同一句中性回执；
 * 只有服务端说「发信没开通」（全站配置）时，改为给联系邮箱——地址由服务端页面传进来，
 * 这个客户端文件不引用任何服务端模块。实心钮只有「发送重置链接」一枚。
 */
export function ForgotPasswordForm({
  contactEmail,
  expiresInMinutes,
}: {
  contactEmail: string;
  expiresInMinutes: number;
}) {
  const { locale } = useTranslation();
  const copy = getPasswordResetCopy(locale).forgot;
  const minutes = String(expiresInMinutes);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; code?: string; delivery?: string }
        | null;
      if (!res.ok || !data?.ok) {
        const code = data?.code && ERROR_CODES.has(data.code) ? (data.code as PasswordResetRequestErrorCode) : null;
        setError(code ? copy.errors[code] : copy.networkError);
        return;
      }
      setPhase(data.delivery === "unavailable" ? "unavailable" : "sent");
    } catch {
      setError(copy.networkError);
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    setEmail("");
    setError("");
    setPhase("form");
  }

  return (
    <>
      <CardHeader className="border-b border-border pb-5">
        <CardTitle className="font-semibold">{copy.title}</CardTitle>
        <CardDescription>{copy.lead.replace("{minutes}", minutes)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {phase === "form" ? (
          <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
            <Field id="email" label={copy.email}>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
                autoComplete="email"
                placeholder="you@example.com"
                aria-invalid={Boolean(error) && error === copy.errors.INVALID_EMAIL}
              />
            </Field>

            {error ? <FormAlert tone="error">{error}</FormAlert> : null}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" strokeWidth={1.5} aria-hidden />
              ) : null}
              {loading ? copy.submitting : copy.submit}
            </Button>
          </form>
        ) : null}

        {phase === "sent" ? (
          <div className="space-y-3">
            <FormAlert tone="info">{copy.sent.replace("{minutes}", minutes)}</FormAlert>
            <p className="text-meta leading-relaxed text-muted-foreground">{copy.sentHint}</p>
            <button
              type="button"
              onClick={startOver}
              className="text-meta font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {copy.tryAnother}
            </button>
          </div>
        ) : null}

        {phase === "unavailable" ? (
          <FormAlert tone="info">
            {copy.unavailableBefore}
            <a
              href={`mailto:${contactEmail}`}
              className="font-mono font-medium text-foreground underline underline-offset-4"
            >
              {contactEmail}
            </a>
            {copy.unavailableAfter}
          </FormAlert>
        ) : null}

        <div className="border-t border-border pt-5 text-center">
          <p className="text-meta text-muted-foreground">
            {copy.remembered}{" "}
            <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              {copy.backToLogin}
            </Link>
          </p>
        </div>
      </CardContent>
    </>
  );
}
