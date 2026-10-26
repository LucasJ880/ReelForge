import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PILOT_APPLY_HREF,
  quotaContactHref,
  quotaNextStepsCopy,
  type QuotaCopyLocale,
} from "@/lib/quota-next-steps";
import { cn } from "@/lib/utils";

/**
 * 额度用完时的两个真实入口（2026-10-25 审计 A7）：申请陪跑试点（/#pilot-apply）与联系我们。
 *
 * 邮箱由服务端页面用 contactEmail()（src/lib/config/contact.ts）取好、以 props 传进来——
 * 客户端组件不读环境变量、不 import 服务端模块（铁律 #5）。没拿到邮箱就只给试点入口，不猜地址。
 * 没有 hooks，服务端 / 客户端组件里都能直接用。
 */
export function QuotaNextSteps({
  locale,
  contactEmail,
  className,
}: {
  locale: QuotaCopyLocale;
  contactEmail?: string | null;
  className?: string;
}) {
  const copy = quotaNextStepsCopy(locale);
  const email = contactEmail?.trim() || null;
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 text-meta", className)}
      data-testid="quota-next-steps"
    >
      <span className="text-muted-foreground">{copy.lead}</span>
      <Button render={<Link href={PILOT_APPLY_HREF} />} variant="outline" size="xs">
        {copy.pilot}
        <ArrowRight aria-hidden />
      </Button>
      {email ? (
        <Button render={<a href={quotaContactHref(email, locale)} />} variant="ghost" size="xs">
          <Mail aria-hidden />
          {copy.contact}
          <span className="font-mono text-data text-muted-foreground">{email}</span>
        </Button>
      ) : null}
    </div>
  );
}
