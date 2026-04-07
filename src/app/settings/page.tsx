import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

function EnvStatus({ name, envKey, hint }: { name: string; envKey: string; hint?: string }) {
  const isSet = !!process.env[envKey];
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <div className="flex items-center gap-2">
        {isSet ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-gray-300" />
        )}
        <span>{name}</span>
      </div>
      <span className={isSet ? "text-green-600" : "text-gray-400"}>
        {isSet ? "已配置" : hint || "未配置"}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const mockMode = !process.env.ARK_API_KEY || !process.env.TIKTOK_CLIENT_KEY;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">设置</h2>

      {mockMode && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0" />
            <p className="text-sm text-yellow-700">
              当前处于 Mock 模式 — 视频生成和 TikTok 发布使用模拟数据。配置 API
              Key 后自动切换为真实模式。
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>TikTok 账号</CardTitle>
          <CardDescription>
            绑定你的 TikTok 账号以启用视频发布功能
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 rounded-lg border border-dashed">
            <div>
              <p className="text-sm font-medium">尚未绑定 TikTok 账号</p>
              <p className="text-xs text-gray-500 mt-1">
                绑定后可以直接从平台发布视频到 TikTok
              </p>
            </div>
            <Button variant="outline" disabled>
              绑定 TikTok
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API 连接状态</CardTitle>
          <CardDescription>外部服务的配置状态</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <EnvStatus name="OpenAI" envKey="OPENAI_API_KEY" />
          <EnvStatus name="即梦 / 火山方舟" envKey="ARK_API_KEY" hint="Mock 模式" />
          <EnvStatus name="TikTok Client" envKey="TIKTOK_CLIENT_KEY" hint="Mock 模式" />
          <EnvStatus name="数据库 (Neon)" envKey="DATABASE_URL" />
          <EnvStatus name="Cron Secret" envKey="CRON_SECRET" hint="可选" />
        </CardContent>
      </Card>
    </div>
  );
}
