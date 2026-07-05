"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clapperboard, Loader2 } from "lucide-react";

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
    <div className="space-y-7 text-center">
      <div className="space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
          <Clapperboard className="h-7 w-7 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            Aivora · 产品视频生成器
          </h1>
          <p className="mt-1.5 text-xs" style={{ color: "var(--glass-text-dim)" }}>
            AI 创作工具 · 请登录后使用
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 text-left">
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="glass-input"
          placeholder="账号（邮箱）"
        />
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="glass-input"
          placeholder="密码"
        />

        {error && (
          <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="glass-btn-primary w-full py-2.5 text-sm tracking-[0.3em]"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? "登录中" : "登 录"}
        </button>
      </form>

      <div className="space-y-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => doLogin(DEMO_EMAIL, DEMO_PASSWORD)}
          className="glass-btn w-full text-xs"
        >
          使用演示账号一键体验（{DEMO_EMAIL}）
        </button>
        <p className="text-[11px]" style={{ color: "var(--glass-text-dim)" }}>
          登录后 7 天内免登录 · 账号问题请联系管理员
        </p>
        <p className="text-[11px]" style={{ color: "var(--glass-text-dim)" }}>
          还没有账号？{" "}
          <Link
            href="/register"
            className="text-sky-300 underline-offset-4 hover:underline"
          >
            创建个人账号
          </Link>
        </p>
      </div>
    </div>
  );
}
