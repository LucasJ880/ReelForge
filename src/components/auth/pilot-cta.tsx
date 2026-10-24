"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 登录门的主行动：「申请试点」（D5）。指向公开首页的试点申请表。
 * 一页一枚实心主钮：登录页上它是实心、登录按钮降为描边；
 * 注册页的主行动是「创建账号」，这里退成描边，免得一屏两枚实心。
 */
export function PilotCta({ label, hint }: { label: string; hint: string }) {
  const pathname = usePathname();
  const primary = !pathname?.startsWith("/register");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="pilot-cta">
      <Button render={<Link href="/#pilot-apply" />} variant={primary ? "default" : "outline"} size="lg">
        {label}
        <ArrowRight aria-hidden />
      </Button>
      <p className="max-w-[36ch] text-meta text-muted-foreground">{hint}</p>
    </div>
  );
}
