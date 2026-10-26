import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getPasswordResetCopy } from "@/i18n/password-reset-copy";
import { getServerLocale } from "@/i18n/server";
import { contactEmail } from "@/lib/config/contact";
import { RESET_TOKEN_TTL_MINUTES } from "@/lib/services/password-reset-service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = getPasswordResetCopy(await getServerLocale());
  return { title: copy.metadata.forgotTitle };
}

/**
 * 忘记密码（登录门同一套布局）。联系邮箱在服务端取好再传给客户端表单：
 * 客户端读不到 AIVORA_CONTACT_EMAIL，也不该引用服务端模块。
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm contactEmail={contactEmail()} expiresInMinutes={RESET_TOKEN_TTL_MINUTES} />;
}
