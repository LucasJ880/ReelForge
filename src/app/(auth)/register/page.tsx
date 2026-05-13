"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">创建个人账号</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          一句话描述想法，AI 帮你出短视频
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block text-xs font-medium text-muted-foreground"
          >
            邮箱
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="name"
            className="block text-xs font-medium text-muted-foreground"
          >
            昵称（可选）
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="给自己起个名字"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="block text-xs font-medium text-muted-foreground"
          >
            密码（至少 8 位）
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading ? "创建中" : "创建账号"}
        </button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        已经有账号？{" "}
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline"
        >
          立即登录
        </Link>
      </p>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        注册即代表你同意 Aivora 使用 AI 生成的视频会含轻微随机性。
        <br />
        商家账号请联系我们获得邀请。
      </p>
    </div>
  );
}
