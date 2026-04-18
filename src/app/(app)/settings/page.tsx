"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Crown, ArrowRight } from "lucide-react";
import { useSubscription } from "@/lib/hooks/use-role";

export default function SettingsPage() {
  const { data: session } = useSession();
  const sub = useSubscription();

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">
          配置
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-white">设置</h1>
      </div>

      {/* Account */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground font-medium mb-3">
          账户
        </p>
        <div className="rounded-xl border border-white/5 bg-card/60 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">{session?.user?.name || "未命名"}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{session?.user?.email}</p>
            </div>
            <span className="rounded-full bg-primary/15 text-primary text-[11px] px-2.5 py-0.5 font-medium">
              {session?.user?.role || "USER"}
            </span>
          </div>
        </div>
      </div>

      {/* Subscription */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground font-medium mb-3">
          订阅
        </p>
        <Link
          href="/settings/billing"
          className="flex items-center justify-between rounded-xl border border-white/5 bg-card/60 px-4 py-4 hover:border-primary/30 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                sub.isActive
                  ? "bg-primary/15 text-primary"
                  : "bg-muted-foreground/10 text-muted-foreground"
              }`}
            >
              <Crown className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {sub.tier === "ADMIN"
                  ? "管理员"
                  : sub.tier === "PRO"
                    ? "Pro 订阅中"
                    : "免费用户"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {sub.tier === "FREE"
                  ? "点击查看订阅方案解锁创作功能"
                  : sub.daysLeft != null
                    ? `剩余 ${sub.daysLeft} 天 · 点击管理订阅`
                    : "点击管理订阅"}
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
      </div>

      {/* API Status */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground font-medium mb-3">
          API 连接状态
        </p>
        <div className="rounded-xl border border-white/5 divide-y divide-border px-4">
          <EnvRow name="OpenAI" status={true} />
          <EnvRow name="即梦 / 火山方舟" status={true} />
          <EnvRow name="Vercel Blob" status={true} />
          <EnvRow name="数据库 (Neon)" status={true} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          API Key 状态在服务端检查，此处显示简化状态
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
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
        <span className={`h-1.5 w-1.5 rounded-full ${status ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
        <span className="text-sm text-foreground">{name}</span>
      </div>
      <span className={status ? "text-xs text-emerald-400" : "text-xs text-muted-foreground"}>
        {status ? "已配置" : hint || "未配置"}
      </span>
    </div>
  );
}
