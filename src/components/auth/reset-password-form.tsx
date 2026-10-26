"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FormAlert } from "@/components/leads/form-fields";
import { useTranslation } from "@/i18n/useTranslation";
import { getPasswordResetCopy, type PasswordResetConfirmErrorCode } from "@/i18n/password-reset-copy";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordPolicyViolation } from "@/lib/config/password-policy";

const ERROR_CODES = new Set<string>([
  "INVALID_OR_EXPIRED",
  "WEAK_PASSWORD",
  "INVALID_INPUT",
] satisfies PasswordResetConfirmErrorCode[]);

/// 服务端预检的结果；unknown = 预检没查成（库抖动），照常给表单，由提交时的校验兜底
export type ResetLinkState = "valid" | "invalid" | "unknown";

/**
 * 设置新密码（/reset-password?token=…）。令牌由服务端页面读出并预检后传进来；
 * 链接失效时不给表单，只给「重新获取链接」（此时它是这一屏唯一的实心钮）。
 * 成功后 replace 到 /login?reset=done，登录页给「密码已更新」的提示。
 */
export function ResetPasswordForm({
  token,
  initialState,
  expiresInMinutes,
}: {
  token: string | null;
  initialState: ResetLinkState;
  expiresInMinutes: number;
}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = getPasswordResetCopy(locale).reset;
  const minutes = String(expiresInMinutes);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(!token || initialState === "invalid");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (passwordPolicyViolation(password)) {
      setError(copy.errors.WEAK_PASSWORD);
      return;
    }
    if (password !== confirm) {
      setError(copy.mismatch);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      if (!res.ok || !data?.ok) {
        const code = data?.code && ERROR_CODES.has(data.code) ? (data.code as PasswordResetConfirmErrorCode) : null;
        if (code === "INVALID_OR_EXPIRED") setLinkInvalid(true);
        else setError(code ? copy.errors[code] : copy.networkError);
        setLoading(false);
        return;
      }
      /// 保持 loading 直到跳走，避免重复提交
      router.replace("/login?reset=done");
    } catch {
      setError(copy.networkError);
      setLoading(false);
    }
  }

  return (
    <>
      <CardHeader className="border-b border-border pb-5">
        <CardTitle className="font-semibold">{copy.title}</CardTitle>
        <CardDescription>{copy.lead}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {linkInvalid ? (
          <div className="space-y-4">
            <FormAlert tone="error">{copy.invalidLink.replace("{minutes}", minutes)}</FormAlert>
            <Button render={<Link href="/forgot-password" />} className="w-full">
              {copy.requestNew}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
            <Field id="new-password" label={copy.password}>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                placeholder={copy.passwordPlaceholder}
                aria-invalid={Boolean(error) && error === copy.errors.WEAK_PASSWORD}
              />
            </Field>
            <Field id="confirm-password" label={copy.confirm}>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                placeholder={copy.confirmPlaceholder}
                aria-invalid={Boolean(error) && error === copy.mismatch}
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
        )}

        <div className="border-t border-border pt-5 text-center">
          <Link href="/login" className="text-meta font-medium text-foreground underline-offset-4 hover:underline">
            {copy.backToLogin}
          </Link>
        </div>
      </CardContent>
    </>
  );
}
