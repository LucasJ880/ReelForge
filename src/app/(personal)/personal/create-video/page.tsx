import { UnifiedCreativeInputShell } from "@/components/video-generation/unified-creative-input-shell";

export default function CreateVideoPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">生成你的视频</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          用一句话描述画面，选好时长，一键生成。有参考图可以上传，没有也能直接开拍。
        </p>
      </header>
      <UnifiedCreativeInputShell userType="personal" />
    </div>
  );
}
