import { GlassBackground } from "@/components/glass/glass-background";

/**
 * 落地起始界面 = 登录门（对齐同行）：
 * 全屏暗色极光玻璃背景 + 居中玻璃卡片。login / register 共用。
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="aivora-glass relative min-h-screen overflow-hidden">
      <GlassBackground koi={false} />
      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <div className="glass-card w-full max-w-[400px] px-8 py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
