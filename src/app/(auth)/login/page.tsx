"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const DEMO_EMAIL = "demo@aivora.app";
const DEMO_PASSWORD = "aivora2026";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function doLogin(loginEmail: string, loginPassword: string) {
    setError("");
    setLoading(true);
    const result = await signIn("credentials", {
      email: loginEmail,
      password: loginPassword,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError("账号或密码错误");
      return;
    }
    router.push(from);
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doLogin(email, password);
  }

  return (
    <>
      <CardHeader className="border-b border-border pb-5">
        <CardTitle className="font-semibold">欢迎回到创作室</CardTitle>
        <CardDescription>登录 Aivora，继续制作下一支短视频。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-meta font-medium">
              邮箱
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
            <label htmlFor="password" className="text-meta font-medium">
              密码
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              placeholder="输入密码"
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
            {loading ? "登录中" : "登录"}
          </Button>
        </form>

        <div className="space-y-3 border-t border-border pt-5 text-center">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => doLogin(DEMO_EMAIL, DEMO_PASSWORD)}
            className="w-full"
          >
            使用演示账号体验
          </Button>
          <p className="text-meta text-muted-foreground">
            登录后 7 天内免登录 · 账号问题请联系管理员
          </p>
          <p className="text-meta text-muted-foreground">
            还没有账号？{" "}
            <Link
              href="/register"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              创建个人账号
            </Link>
          </p>
        </div>
      </CardContent>
    </>
  );
}
