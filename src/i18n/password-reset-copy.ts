import type { Locale } from "./config";

/**
 * 密码找回（/forgot-password、/reset-password 与那封重置邮件）的文案（1025 整合轮）。
 * 纯数据：客户端组件可直接引用。占位符 {minutes} / {contact} 由调用方替换。
 *
 * 口径：申请页无论邮箱是否注册、是否停用，一律给同一句中性回执（不泄露账号是否存在）；
 * 只有「发信没开通」是全站配置问题，才改成给联系邮箱。
 */

/// /api/auth/password-reset/request 的错误码（与注册路由同一风格：大写下划线，前端按语言出文案）
export type PasswordResetRequestErrorCode = "INVALID_EMAIL" | "RATE_LIMITED" | "INVALID_INPUT";

/// /api/auth/password-reset/confirm 的错误码
export type PasswordResetConfirmErrorCode = "INVALID_OR_EXPIRED" | "WEAK_PASSWORD" | "INVALID_INPUT";

interface PasswordResetCopy {
  metadata: { forgotTitle: string; resetTitle: string };
  forgot: {
    title: string;
    lead: string;
    email: string;
    submit: string;
    submitting: string;
    sent: string;
    sentHint: string;
    tryAnother: string;
    unavailableBefore: string;
    unavailableAfter: string;
    remembered: string;
    backToLogin: string;
    networkError: string;
    errors: Record<PasswordResetRequestErrorCode, string>;
  };
  reset: {
    title: string;
    lead: string;
    password: string;
    passwordPlaceholder: string;
    confirm: string;
    confirmPlaceholder: string;
    submit: string;
    submitting: string;
    mismatch: string;
    invalidLink: string;
    requestNew: string;
    backToLogin: string;
    networkError: string;
    errors: Record<PasswordResetConfirmErrorCode, string>;
  };
  email: {
    subject: string;
    intro: string;
    action: string;
    ignore: string;
    help: string;
  };
}

const ZH: PasswordResetCopy = {
  metadata: {
    forgotTitle: "找回密码 · Aivora",
    resetTitle: "设置新密码 · Aivora",
  },
  forgot: {
    title: "找回密码",
    lead: "输入注册时用的邮箱，我们发一封重置密码的链接，{minutes} 分钟内有效。",
    email: "邮箱",
    submit: "发送重置链接",
    submitting: "发送中",
    sent: "如果这个邮箱注册过 Aivora，重置链接已经发出：{minutes} 分钟内有效，只能用一次。",
    sentHint: "几分钟内没收到，先看看垃圾邮件箱；也可能是注册时用了别的邮箱。",
    tryAnother: "换个邮箱再试",
    unavailableBefore: "邮件发送还没开通，暂时没法自动发重置链接。请写信到 ",
    unavailableAfter: "，注明注册邮箱，我们核对后帮你重置密码。",
    remembered: "想起来了？",
    backToLogin: "返回登录",
    networkError: "网络异常，请稍后再试。",
    errors: {
      INVALID_EMAIL: "请输入有效的邮箱。",
      RATE_LIMITED: "申请太频繁了，请过一会儿再试。",
      INVALID_INPUT: "有一项填得不太对，请检查后再提交。",
    },
  },
  reset: {
    title: "设置新密码",
    lead: "新密码至少 8 位。设置成功后，用新密码重新登录。",
    password: "新密码（至少 8 位）",
    passwordPlaceholder: "输入至少 8 位密码",
    confirm: "再输一次",
    confirmPlaceholder: "再输一次新密码",
    submit: "保存新密码",
    submitting: "保存中",
    mismatch: "两次输入的密码不一致。",
    invalidLink: "这个重置链接已经失效：链接 {minutes} 分钟内有效，只能用一次。请重新获取。",
    requestNew: "重新获取链接",
    backToLogin: "返回登录",
    networkError: "网络异常，请稍后再试。",
    errors: {
      INVALID_OR_EXPIRED: "这个重置链接已经失效：链接 {minutes} 分钟内有效，只能用一次。请重新获取。",
      WEAK_PASSWORD: "密码至少 8 位，最多 128 位。",
      INVALID_INPUT: "有一项填得不太对，请检查后再提交。",
    },
  },
  email: {
    subject: "重置你的 Aivora 密码",
    intro: "有人（希望是你本人）申请重置这个邮箱在 Aivora 的登录密码。",
    action: "打开下面的链接设置新密码，{minutes} 分钟内有效，只能用一次：",
    ignore: "如果不是你本人申请的，忽略这封邮件即可，密码不会改变。",
    help: "需要帮助请写信到 {contact}。",
  },
};

const EN: PasswordResetCopy = {
  metadata: {
    forgotTitle: "Reset password · Aivora",
    resetTitle: "Set a new password · Aivora",
  },
  forgot: {
    title: "Reset your password",
    lead: "Enter the email you signed up with and we will send a reset link. It works for {minutes} minutes.",
    email: "Email",
    submit: "Send reset link",
    submitting: "Sending",
    sent: "If that email has an Aivora account, we sent a reset link. It works once, for {minutes} minutes.",
    sentHint: "Nothing after a few minutes? Check your spam folder, or you may have signed up with a different email.",
    tryAnother: "Try a different email",
    unavailableBefore: "Email sending isn't set up yet, so we can't send reset links automatically. Write to ",
    unavailableAfter: " with the email you signed up with and we will reset your password after checking it's you.",
    remembered: "Remembered it?",
    backToLogin: "Back to sign in",
    networkError: "Network error. Try again.",
    errors: {
      INVALID_EMAIL: "Enter a valid email.",
      RATE_LIMITED: "Too many requests just now. Please try again later.",
      INVALID_INPUT: "Something doesn't look right. Check the form and try again.",
    },
  },
  reset: {
    title: "Set a new password",
    lead: "Use at least 8 characters. Once it is saved, sign in with the new password.",
    password: "New password (8+ characters)",
    passwordPlaceholder: "Enter at least 8 characters",
    confirm: "Confirm password",
    confirmPlaceholder: "Enter the new password again",
    submit: "Save new password",
    submitting: "Saving",
    mismatch: "The two passwords don't match.",
    invalidLink: "This reset link no longer works: links work once, for {minutes} minutes. Request a new one.",
    requestNew: "Request a new link",
    backToLogin: "Back to sign in",
    networkError: "Network error. Try again.",
    errors: {
      INVALID_OR_EXPIRED: "This reset link no longer works: links work once, for {minutes} minutes. Request a new one.",
      WEAK_PASSWORD: "Use 8 to 128 characters for the password.",
      INVALID_INPUT: "Something doesn't look right. Check the form and try again.",
    },
  },
  email: {
    subject: "Reset your Aivora password",
    intro: "Someone (hopefully you) asked to reset the Aivora password for this email address.",
    action: "Open the link below to set a new password. It works once, for {minutes} minutes:",
    ignore: "If this wasn't you, ignore this email and your password stays the same.",
    help: "Need help? Write to {contact}.",
  },
};

export const PASSWORD_RESET_COPY: Record<Locale, PasswordResetCopy> = { "zh-CN": ZH, "en-US": EN };

export function getPasswordResetCopy(locale: Locale): PasswordResetCopy {
  return locale === "en-US" ? EN : ZH;
}
