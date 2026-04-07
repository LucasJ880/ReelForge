import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

function EnvStatus({ name, envKey, hint }: { name: string; envKey: string; hint?: string }) {
  const isSet = !!process.env[envKey];
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2.5">
        {isSet ? (
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-200" />
        )}
        <span className="text-sm text-zinc-700">{name}</span>
      </div>
      <span className={isSet ? "text-xs text-emerald-600" : "text-xs text-zinc-400"}>
        {isSet ? "已配置" : hint || "未配置"}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const mockMode = !process.env.ARK_API_KEY || !process.env.TIKTOK_CLIENT_KEY;

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-400 font-medium mb-2">
          配置
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">设置</h1>
      </div>

      {mockMode && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4">
          <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            当前处于 Mock 模式 — 视频生成和 TikTok 发布使用模拟数据。配置 API Key 后自动切换为真实模式。
          </p>
        </div>
      )}

      {/* TikTok */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-3">
          TikTok 账号
        </p>
        <div className="rounded-xl border border-dashed border-zinc-200 p-5">
          <p className="text-sm font-medium text-zinc-700">尚未绑定 TikTok 账号</p>
          <p className="text-xs text-zinc-400 mt-1">
            绑定后可以直接从平台发布视频到 TikTok
          </p>
          <button
            disabled
            className="mt-3 inline-flex items-center rounded-lg bg-zinc-100 px-3.5 py-2 text-sm text-zinc-400 cursor-not-allowed"
          >
            绑定 TikTok
          </button>
        </div>
      </div>

      {/* API Status */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-medium mb-3">
          API 连接状态
        </p>
        <div className="rounded-xl border border-zinc-100 divide-y divide-zinc-100 px-4">
          <EnvStatus name="OpenAI" envKey="OPENAI_API_KEY" />
          <EnvStatus name="即梦 / 火山方舟" envKey="ARK_API_KEY" hint="Mock 模式" />
          <EnvStatus name="TikTok Client" envKey="TIKTOK_CLIENT_KEY" hint="Mock 模式" />
          <EnvStatus name="数据库 (Neon)" envKey="DATABASE_URL" />
          <EnvStatus name="Cron Secret" envKey="CRON_SECRET" hint="可选" />
        </div>
      </div>
    </div>
  );
}
