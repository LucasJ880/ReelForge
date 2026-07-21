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
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

export default function RegisterPage() {
  const router = useRouter();
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).auth;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(typeof data?.error === "string" ? data.error : copy.registerFailed);
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

      router.push("/app/create");
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
        <CardDescription>{copy.registerDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-body font-medium">
            {copy.email}
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(error)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="name" className="text-body font-medium">
            {copy.displayName}
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoComplete="name"
              placeholder={copy.displayNamePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-body font-medium">
            {copy.newPassword}
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder={copy.newPasswordPlaceholder}
              aria-invalid={Boolean(error)}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-(--radius-md) border border-danger bg-muted px-3 py-2 text-meta text-danger"
            >
              {error}
            </p>
          ) : null}

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
