"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("邮箱或密码错误");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="relative w-full max-w-[400px] px-6">
      {/* Background glow */}
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[500px] h-[400px] rounded-full bg-violet-600/[0.07] blur-[100px] pointer-events-none" />

      <div className="relative">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-5">
            <Logo size={44} />
          </div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">
            欢迎回来
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            登录你的 Aivora 账号
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-xs font-medium text-zinc-400">
                邮箱地址
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30 transition-colors"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-zinc-400">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-violet-600 py-3 text-sm font-medium text-white transition-all hover:bg-violet-500 disabled:opacity-50 shadow-lg shadow-violet-600/20"
            >
              {loading ? "登录中..." : "登录"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-zinc-600 mt-6">
          还没有账号？{" "}
          <Link href="/register" className="text-violet-400 hover:text-violet-300 font-medium">
            免费注册
          </Link>
        </p>
      </div>
    </div>
  );
}
