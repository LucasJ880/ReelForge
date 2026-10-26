import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 登录门左栏的「申请试点」：指向公开首页的陪跑申请表。
 * 一页一枚实心主钮（C1）：登录页的实心钮是「登录」、注册页是「创建账号」，这里一律描边。
 */
export function PilotCta({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="pilot-cta">
      <Button render={<Link href="/#pilot-apply" />} variant="outline" size="lg">
        {label}
        <ArrowRight aria-hidden />
      </Button>
      <p className="max-w-[36ch] text-meta text-muted-foreground">{hint}</p>
    </div>
  );
}
