import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function NotFoundPage() {
  return (
    <div className="desk-canvas flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
      <Logo size={36} />
      <p className="font-mono text-[clamp(56px,10vw,128px)] font-extralight leading-none tabular-nums text-accent">404</p>
      <h1 className="x-display text-[clamp(28px,4vw,44px)]">页面不存在</h1>
      <p className="max-w-md text-body leading-relaxed text-muted-foreground">
        链接可能已过期或输入有误。
      </p>
      {/* 全局 404 对所有角色可见：回 / 由角色路由决定去处。
          此前指向旧代运营入口，客户看不懂那套叫法（0802 录屏）。 */}
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center justify-center rounded-(--radius-md) border border-primary bg-primary px-4 text-meta font-semibold text-primary-foreground transition-colors hover:border-accent-strong hover:bg-accent-strong"
      >
        回到工作台
      </Link>
    </div>
  );
}
