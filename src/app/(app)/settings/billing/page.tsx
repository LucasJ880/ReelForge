"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useSubscription } from "@/lib/hooks/use-role";
import { Crown, Shield, Mail, Clock, ArrowLeft, Sparkles } from "lucide-react";

const SUPPORT_EMAIL = "support@aivora.app";

export default function BillingPage() {
  const { data: session } = useSession();
  const sub = useSubscription();

  const email = session?.user?.email || "";
  const mailtoHref = useMemo(() => {
    const subject = encodeURIComponent("[Aivora] 开通 Pro 订阅");
    const body = encodeURIComponent(
      `管理员您好，\n\n我的账号：${email}\n我希望开通 Pro 订阅：\n\n[ ] 1 个月（¥129）\n[ ] 3 个月（¥369）\n[ ] 12 个月（¥1188，约 ¥99/月）\n\n我的付款方式：\n[ ] 微信 / 支付宝转账\n[ ] 其他：\n\n谢谢！`,
    );
    return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }, [email]);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3 w-3" />
          返回设置
        </Link>
        <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">
          订阅与账单
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-white">Billing</h1>
      </div>

      {/* Current plan */}
      <section className="rounded-2xl border border-border bg-card/40 p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {sub.tier === "ADMIN" ? (
                <Crown className="h-4 w-4 text-amber-400" />
              ) : sub.tier === "PRO" ? (
                <Crown className="h-4 w-4 text-primary" />
              ) : (
                <Shield className="h-4 w-4 text-muted-foreground" />
              )}
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                  sub.tier === "ADMIN"
                    ? "bg-amber-500/15 text-amber-400"
                    : sub.tier === "PRO"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted-foreground/15 text-muted-foreground"
                }`}
              >
                {sub.tier}
              </span>
            </div>
            <p className="text-sm text-foreground">
              {sub.tier === "ADMIN"
                ? "管理员账号 · 无限制访问所有功能"
                : sub.tier === "PRO"
                  ? "Pro 订阅中 · 全部创作功能已解锁"
                  : "当前为免费用户 · 仅可浏览和下载公开画廊视频"}
            </p>
          </div>
        </div>

        {sub.tier === "PRO" && sub.expiresAt && (
          <div className="flex items-center gap-2 rounded-lg bg-accent/40 px-3 py-2 mb-3">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span className="text-[12px] text-muted-foreground">
              到期时间：
              <span className="text-foreground ml-1">
                {sub.expiresAt.toLocaleDateString("zh-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              {sub.daysLeft != null && sub.daysLeft > 0 && (
                <span className="text-primary ml-2">（剩余 {sub.daysLeft} 天）</span>
              )}
            </span>
          </div>
        )}

        {sub.tier === "FREE" && (
          <div className="rounded-lg bg-primary/[0.06] border border-primary/20 p-4">
            <p className="text-sm font-medium text-primary mb-1">
              <Sparkles className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
              升级 Pro 解锁全部功能
            </p>
            <p className="text-[12px] text-muted-foreground mb-3 leading-relaxed">
              AI 一键视频生成、Brand Lock 品牌叠加、批量处理、优先队列等全部功能。
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              查看订阅方案
            </Link>
          </div>
        )}
      </section>

      {/* Upgrade instructions */}
      <section className="rounded-2xl border border-border bg-card/40 p-5">
        <h2 className="text-sm font-semibold text-white mb-3">
          如何{sub.tier === "PRO" ? "续费" : "开通"}订阅
        </h2>
        <p className="text-[12px] text-muted-foreground mb-4 leading-relaxed">
          MVP 阶段我们暂未接入在线支付，订阅由管理员手动开通。流程很简单：
        </p>
        <ol className="space-y-3 text-[13px] text-muted-foreground">
          <Step n={1}>
            通过邮件联系管理员（
            <a
              href={mailtoHref}
              className="text-primary hover:underline font-medium"
            >
              {SUPPORT_EMAIL}
            </a>
            ），说明你要开通的月份数
          </Step>
          <Step n={2}>
            收到回复后，通过微信 / 支付宝转账对应金额
          </Step>
          <Step n={3}>
            管理员确认收款后，在后台开通你的 Pro 权限
          </Step>
          <Step n={4}>
            在本页面<strong className="text-foreground">重新登录或刷新 session</strong>即可立即生效
          </Step>
        </ol>

        <div className="mt-5 flex flex-wrap gap-2">
          <a
            href={mailtoHref}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Mail className="h-3.5 w-3.5" />
            发送开通申请邮件
          </a>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40"
          >
            查看套餐详情
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card/20 p-5">
        <h2 className="text-sm font-semibold text-white mb-2">未来计划</h2>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          我们已经预留了 Stripe / Creem 的集成位，等流量稳定后会直接开放自助订阅、发票、续费管理。
          MVP 手动开通流程会一直保留作为兜底通道。
        </p>
      </section>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary shrink-0">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
