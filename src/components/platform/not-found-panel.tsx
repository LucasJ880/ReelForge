import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TickGlyph } from "@/components/exchange/status-tick";
import type { Locale } from "@/i18n/config";
import { getPlatformCopy } from "@/i18n/platform-copy";

/**
 * 404 面板（1025 · B2.7）：全局 404 与工作区内的 404 共用。双语；
 * 不用巨大的信号青数字做装饰——颜色只给数据，状态记号用失败的下跌三角。
 * 回 / 由角色路由决定去处；此前指向旧代运营入口，客户看不懂那套叫法（0802 录屏）。
 */
export function NotFoundPanel({ locale, workspaceHref = "/app/create" }: { locale: Locale; workspaceHref?: string | null }) {
  const copy = getPlatformCopy(locale).notFound;
  return (
    <section className="x-panel w-full max-w-lg space-y-5 p-6 sm:p-8" aria-labelledby="not-found-title" data-route-state="not-found">
      <p className="flex items-center gap-2 font-mono text-data uppercase tracking-wide text-danger">
        <TickGlyph tone="fault" />
        {copy.code}
      </p>
      <h1 id="not-found-title" className="x-display">{copy.title}</h1>
      <p className="max-w-[46ch] text-body text-muted-foreground text-pretty">{copy.body}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button render={<Link href="/" />}>
          {copy.home}
          <ArrowRight aria-hidden />
        </Button>
        {workspaceHref ? (
          <Button render={<Link href={workspaceHref} />} variant="outline">
            {copy.workspace}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
