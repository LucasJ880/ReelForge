import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-foreground">
      <div className="flex flex-col items-center text-center">
        <Logo size={32} />
        <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.24em] text-primary">
          404 · Not Found
        </p>
        <h1 className="mt-3 max-w-md text-3xl font-semibold tracking-tight">
          页面不存在
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          链接可能已过期或输入有误。
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {/* 全局 404 对所有角色可见：回 / 由角色路由决定去处。
              此前指向旧代运营入口，客户看不懂那套叫法（0802 录屏）。 */}
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-(--radius-md) bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            回到工作台
          </Link>
        </div>
      </div>
    </div>
  );
}
