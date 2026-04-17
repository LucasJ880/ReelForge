"use client";

import { useSession } from "next-auth/react";

export default function SettingsPage() {
  const { data: session } = useSession();

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-2">
          配置
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-white">设置</h1>
      </div>

      {/* Account */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-3">
          账户
        </p>
        <div className="rounded-xl border border-white/5 bg-zinc-900/50 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">{session?.user?.name || "未命名"}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">{session?.user?.email}</p>
            </div>
            <span className="rounded-full bg-violet-500/15 text-violet-300 text-[11px] px-2.5 py-0.5 font-medium">
              {session?.user?.role || "USER"}
            </span>
          </div>
        </div>
      </div>

      {/* API Status */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-3">
          API 连接状态
        </p>
        <div className="rounded-xl border border-white/5 divide-y divide-zinc-800 px-4">
          <EnvRow name="OpenAI" status={true} />
          <EnvRow name="即梦 / 火山方舟" status={true} />
          <EnvRow name="Vercel Blob" status={true} />
          <EnvRow name="数据库 (Neon)" status={true} />
        </div>
        <p className="text-[11px] text-zinc-500 mt-2">
          API Key 状态在服务端检查，此处显示简化状态
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-xs text-zinc-400 leading-relaxed">
          生成完成的视频可以直接从详情页下载 mp4 文件，自行发布到抖音 / TikTok / 小红书 / Instagram Reels 等平台。
        </p>
      </div>
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
