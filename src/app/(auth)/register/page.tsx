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

export default function RegisterPage() {
  const router = useRouter();
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
        setError(typeof data?.error === "string" ? data.error : "注册失败，请稍后再试");
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
        setError("注册成功但自动登录失败，请前往登录页手动登录");
        return;
      }

      router.push("/personal");
      router.refresh();
    } catch {
      setError("网络异常，请稍后再试");
      setLoading(false);
    }
  }

  return (
    <>
      <CardHeader className="border-b border-border pb-5">
        <CardTitle>创建个人账号</CardTitle>
        <CardDescription>一句话描述想法，AI 帮你完成短视频。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <label htmlFor="name" className="text-meta font-medium">
            昵称（可选）
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoComplete="name"
              placeholder="给自己起个名字"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-meta font-medium">
            密码（至少 8 位）
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="输入至少 8 位密码"
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
            {loading ? "创建中" : "创建账号"}
          </Button>
        </form>

        <div className="space-y-3 border-t border-border pt-5 text-center">
          <p className="text-meta text-muted-foreground">
            已经有账号？{" "}
            <Link
              href="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              立即登录
            </Link>
          </p>
          <p className="text-meta leading-relaxed text-muted-foreground">
            注册即代表你了解 AI 生成视频可能存在轻微随机性。
            <br />
            商家账号请联系我们获得邀请。
          </p>
        </div>
      </CardContent>
    </>
  );
}
