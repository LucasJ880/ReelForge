/**
 * 额度用完之后的真实下一步（2026-10-25 审计 A7）。
 *
 * 之前额度用完写「可在『用量与账单』查看额度，或下月再试」：那个页面早就没了（重定向到创作页），
 * 结账接口也没有界面——试用账号只剩「下月再试」，是死路。现在只给两条真能走的路：
 *  1. 申请陪跑试点：公开首页的试点申请表（/#pilot-apply）；
 *  2. 联系我们：对外联系邮箱——只在服务端用 contactEmail()（src/lib/config/contact.ts）取值，
 *     再以 props 传给客户端组件；客户端拿不到邮箱时只写「联系我们」，不猜地址。
 *
 * 纯常量与纯函数：不读 process.env、不 import 任何服务端模块，客户端组件可以直接用。
 */
export const PILOT_APPLY_HREF = "/#pilot-apply";

export type QuotaCopyLocale = "zh-CN" | "en-US";

export type QuotaNextStepsCopy = {
  /** 额度用完的事实（一句）。 */
  exhausted: string;
  /** 两个入口前的引导语。 */
  lead: string;
  pilot: string;
  contact: string;
};

export function quotaNextStepsCopy(locale: QuotaCopyLocale): QuotaNextStepsCopy {
  return locale === "en-US"
    ? {
        exhausted: "This month's video allowance is used up.",
        lead: "To keep producing:",
        pilot: "Apply for the guided pilot",
        contact: "Contact us",
      }
    : {
        exhausted: "本月视频额度已用完。",
        lead: "想继续出片：",
        pilot: "申请陪跑试点",
        contact: "联系我们",
      };
}

/**
 * 只能放一行字的地方（服务端错误信息、批量向导的恢复提示）用的纯文本下一步。
 * 有邮箱就写出来；没有就只写「联系我们」。
 */
export function quotaNextStepsSentence(locale: QuotaCopyLocale, email?: string | null): string {
  const contact = email?.trim();
  if (locale === "en-US") {
    return contact
      ? `To keep producing, apply for the guided pilot on our homepage (${PILOT_APPLY_HREF}) or email us at ${contact}.`
      : `To keep producing, apply for the guided pilot on our homepage (${PILOT_APPLY_HREF}) or contact us.`;
  }
  return contact
    ? `想继续出片：在首页申请陪跑试点（${PILOT_APPLY_HREF}），或写信联系我们：${contact}。`
    : `想继续出片：在首页申请陪跑试点（${PILOT_APPLY_HREF}），或联系我们。`;
}

/** 「联系我们」的 mailto：主题行带上额度用完的上下文，方便创始人一眼认出。 */
export function quotaContactHref(email: string, locale: QuotaCopyLocale): string {
  const subject = locale === "en-US" ? "Aivora · monthly allowance used up" : "Aivora · 本月额度已用完";
  return `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}`;
}
