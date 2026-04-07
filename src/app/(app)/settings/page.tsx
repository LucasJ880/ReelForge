"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, Loader2, LogOut } from "lucide-react";

interface TikTokStatus {
  connected: boolean;
  displayName?: string;
  avatarUrl?: string;
  tokenExpired?: boolean;
  updatedAt?: string;
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const [tiktokStatus, setTiktokStatus] = useState<TikTokStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    const error = searchParams.get("tiktok_error");
    const connected = searchParams.get("tiktok_connected");
    if (error) toast.error(`TikTok 授权失败: ${error}`);
    if (connected) toast.success("TikTok 账号已绑定");
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/auth/tiktok/status")
      .then((r) => r.json())
      .then(setTiktokStatus)
      .catch(() => setTiktokStatus({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/auth/tiktok/status", { method: "DELETE" });
      setTiktokStatus({ connected: false });
      toast.success("TikTok 账号已解绑");
    } catch {
      toast.error("操作失败");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-2">
          配置
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-white">设置</h1>
      </div>

      {/* TikTok Account */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-3">
          TikTok 账号
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400 py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : tiktokStatus?.connected ? (
          <div className="rounded-xl border border-white/5 bg-emerald-500/10 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {tiktokStatus.avatarUrl ? (
                  <img
                    src={tiktokStatus.avatarUrl}
                    alt=""
                    className="h-9 w-9 rounded-full"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-white">
                    {tiktokStatus.displayName || "已绑定 TikTok"}
                  </p>
                  {tiktokStatus.tokenExpired && (
                    <p className="text-[11px] text-amber-400">Token 已过期，请重新绑定</p>
                  )}
                  {!tiktokStatus.tokenExpired && (
                    <p className="text-[11px] text-emerald-400">已连接</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {tiktokStatus.tokenExpired && (
                  <a
                    href="/api/auth/tiktok"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                  >
                    重新绑定
                  </a>
                )}
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 disabled:opacity-50"
                >
                  {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                  解绑
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-800 p-5">
            <p className="text-sm font-medium text-zinc-100">尚未绑定 TikTok 账号</p>
            <p className="text-xs text-zinc-400 mt-1">
              绑定后可以直接从平台发布视频到 TikTok
            </p>
            <a
              href="/api/auth/tiktok"
              className="mt-3 inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              绑定 TikTok
            </a>
          </div>
        )}
      </div>

      {/* API Status */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-3">
          API 连接状态
        </p>
        <div className="rounded-xl border border-white/5 divide-y divide-zinc-800 px-4">
          <EnvRow name="OpenAI" status={true} />
          <EnvRow name="即梦 / 火山方舟" status={true} />
          <EnvRow name="TikTok" status={tiktokStatus?.connected || false} hint={tiktokStatus?.connected ? undefined : "未绑定"} />
          <EnvRow name="数据库 (Neon)" status={true} />
        </div>
        <p className="text-[11px] text-zinc-500 mt-2">
          API Key 状态在服务端检查，此处显示简化状态
        </p>
      </div>

      {/* Mock mode warning */}
      {!tiktokStatus?.connected && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-500/10 p-4">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-300">
            TikTok 未绑定 — 发布和数据拉取将使用模拟数据。绑定 TikTok 账号后自动切换为真实模式。
          </p>
        </div>
      )}
    </div>
  );
}

function EnvRow({ name, status, hint }: { name: string; status: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-2.5">
        <span className={`h-1.5 w-1.5 rounded-full ${status ? "bg-emerald-500" : "bg-zinc-600"}`} />
        <span className="text-sm text-zinc-100">{name}</span>
      </div>
      <span className={status ? "text-xs text-emerald-400" : "text-xs text-zinc-400"}>
        {status ? "已配置" : hint || "未配置"}
      </span>
    </div>
  );
}
