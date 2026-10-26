import type { Metadata } from "next";
import { ResetPasswordForm, type ResetLinkState } from "@/components/auth/reset-password-form";
import { getPasswordResetCopy } from "@/i18n/password-reset-copy";
import { getServerLocale } from "@/i18n/server";
import {
  RESET_TOKEN_TTL_MINUTES,
  inspectPasswordResetToken,
  isWellFormedResetToken,
} from "@/lib/services/password-reset-service";

export const dynamic = "force-dynamic";

/// 链接里带着令牌：不往外站发 Referer、不进搜索索引
export async function generateMetadata(): Promise<Metadata> {
  const copy = getPasswordResetCopy(await getServerLocale());
  return {
    title: copy.metadata.resetTitle,
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * 设置新密码（邮件里的链接落到这里）。打开时只读预检令牌，不消费——邮箱的安全扫描器
 * 预取链接也不会把它用掉；预检查不成（库抖动）照常给表单，提交时的校验兜底。
 */
export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && isWellFormedResetToken(raw) ? raw : null;

  let state: ResetLinkState = token ? "unknown" : "invalid";
  if (token) {
    try {
      state = await inspectPasswordResetToken(token);
    } catch (error) {
      console.warn("[password-reset] token precheck failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return <ResetPasswordForm token={token} initialState={state} expiresInMinutes={RESET_TOKEN_TTL_MINUTES} />;
}
