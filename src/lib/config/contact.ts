/**
 * 对外联系邮箱的唯一来源（2026-10-25 创始人指定：CEO Lucas，lucas@sunnyshutter.ca）。
 * 隐私 / 条款页、试点申请与成品库的「联系支持」、试点申请提醒邮件的收件人都从这里取；
 * 环境变量仍可覆盖（AIVORA_CONTACT_EMAIL / NEXT_PUBLIC_PRIVACY_EMAIL / AIVORA_FOUNDER_EMAIL）。
 * 之前隐私页默认写的 privacy@aivora.ai 没有对应邮箱，客户写信会退回。
 */
export const DEFAULT_CONTACT_EMAIL = "lucas@sunnyshutter.ca";

export function contactEmail(env: NodeJS.ProcessEnv = process.env): string {
  return env.AIVORA_CONTACT_EMAIL?.trim() || env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || DEFAULT_CONTACT_EMAIL;
}

/** 试点申请等内部提醒的收件人：默认就是对外联系人（创始人）。 */
export function founderNotifyEmail(env: NodeJS.ProcessEnv = process.env): string {
  return env.AIVORA_FOUNDER_EMAIL?.trim() || contactEmail(env);
}
