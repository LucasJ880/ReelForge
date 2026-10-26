"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConsentCheckbox, Field, FormAlert, NativeSelect } from "@/components/leads/form-fields";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getOnboardingCopy, type RegisterErrorCode } from "@/i18n/onboarding-copy";
import { BUSINESS_INDUSTRIES, type BusinessIndustry } from "@/lib/onboarding/industries";

const ERROR_CODES = new Set<string>([
  "INVALID_EMAIL",
  "WEAK_PASSWORD",
  "BUSINESS_REQUIRED",
  "INDUSTRY_REQUIRED",
  "TERMS_REQUIRED",
  "EMAIL_TAKEN",
  "RATE_LIMITED",
  "INVALID_INPUT",
] satisfies RegisterErrorCode[]);

/**
 * 自助注册 = 首页「免费试做 3 条」的入口（1025 整合轮 C1）。
 * 店名与行业必填（推荐模板、尾卡、询盘页都用它），城市选填，条款同意必勾；
 * 错误按服务端 code 出当前语言的文案。注册成功自动登录，进 /app/welcome 上手向导。
 */
export default function RegisterPage() {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).auth;
  const onboarding = getOnboardingCopy(locale);
  const reg = onboarding.register;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState<BusinessIndustry | "">("");
  const [city, setCity] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!acceptTerms) {
      setError(reg.errors.TERMS_REQUIRED);
      return;
    }
    if (!industry) {
      setError(reg.errors.INDUSTRY_REQUIRED);
      return;
    }
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          businessName: businessName.trim(),
          industry,
          city: city.trim() || undefined,
          acceptTerms,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string } | null;

      if (!res.ok || !data?.ok) {
        const code = data?.code && ERROR_CODES.has(data.code) ? (data.code as RegisterErrorCode) : null;
        setError(code ? reg.errors[code] : copy.registerFailed);
        setLoading(false);
        return;
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      setLoading(false);

      if (signInResult?.error) {
        setError(copy.autoLoginFailed);
        return;
      }

      router.push("/app/welcome");
      router.refresh();
    } catch {
      setError(copy.networkError);
      setLoading(false);
    }
  }

  return (
    <>
      <CardHeader className="border-b border-border pb-5">
        <CardTitle className="font-semibold">{copy.registerTitle}</CardTitle>
        <CardDescription>{reg.lead}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field id="email" label={copy.email}>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(error) && error === reg.errors.INVALID_EMAIL}
            />
          </Field>

          <Field id="password" label={copy.newPassword}>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder={copy.newPasswordPlaceholder}
              aria-invalid={Boolean(error) && error === reg.errors.WEAK_PASSWORD}
            />
          </Field>

          <Field id="business-name" label={reg.businessName}>
            <Input
              id="business-name"
              type="text"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              required
              maxLength={80}
              autoComplete="organization"
              placeholder={reg.businessNamePlaceholder}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="industry" label={reg.industry}>
              <NativeSelect
                id="industry"
                value={industry}
                required
                onChange={(event) => setIndustry(event.target.value as BusinessIndustry | "")}
                aria-invalid={Boolean(error) && error === reg.errors.INDUSTRY_REQUIRED}
              >
                <option value="" disabled>
                  {reg.industryPlaceholder}
                </option>
                {BUSINESS_INDUSTRIES.map((key) => (
                  <option key={key} value={key}>
                    {onboarding.industries[key]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="city" label={reg.city}>
              <Input
                id="city"
                type="text"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                maxLength={80}
                autoComplete="address-level2"
                placeholder={reg.cityPlaceholder}
              />
            </Field>
          </div>

          <ConsentCheckbox id="accept-terms" checked={acceptTerms} onChange={setAcceptTerms}>
            {reg.termsBefore}
            <Link href="/terms" target="_blank" className="font-medium text-foreground underline underline-offset-4">
              {reg.termsLink}
            </Link>
            {reg.termsJoin}
            <Link href="/privacy" target="_blank" className="font-medium text-foreground underline underline-offset-4">
              {reg.privacyLink}
            </Link>
            {reg.termsAfter}
          </ConsentCheckbox>

          {error ? <FormAlert tone="error">{error}</FormAlert> : null}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <Loader2
                className="animate-spin motion-reduce:animate-none"
                strokeWidth={1.5}
                aria-hidden
              />
            ) : null}
            {loading ? copy.creating : copy.create}
          </Button>
          <p className="font-mono text-data text-tertiary">{reg.trialNote}</p>
        </form>

        <div className="space-y-3 border-t border-border pt-5 text-center">
          <p className="text-meta text-muted-foreground">
            {copy.hasAccount}{" "}
            <Link
              href="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {copy.loginNow}
            </Link>
          </p>
          <p className="text-meta leading-relaxed text-muted-foreground">
            {copy.randomnessNote}
          </p>
        </div>
      </CardContent>
    </>
  );
}
