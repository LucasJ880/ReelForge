/**
 * 一周时段带的日期（1025 · B2.3）：第 N 天 = 计划起始日 + N 天，「今天」按访问者本机时区算。
 *
 * 之前服务端用自己的 getDay() 定「今天」，还把第 0 天硬写成周一：
 * Vercel 是 UTC，太平洋时间每天 17:00 以后光针就跳到明天；周三排的计划也会被画成从周一开始。
 * 纯函数，不引任何模块：client 组件与测试都能直接用。
 */

export const PLAN_DAYS = 7;

/** 起始日的本地零点。 */
export function localStartOfDay(at: Date): Date {
  const day = new Date(at.getTime());
  day.setHours(0, 0, 0, 0);
  return day;
}

/** 计划 7 天的本地日期（按日历加天数，跨夏令时也不会错一天）。 */
export function planDayDates(startIso: string): Date[] {
  const start = localStartOfDay(new Date(startIso));
  return Array.from({ length: PLAN_DAYS }, (_, offset) => {
    const day = new Date(start.getTime());
    day.setDate(start.getDate() + offset);
    return day;
  });
}

/** 今天落在第几天；不在这 7 天里（计划已过期或还没开始）返回 null，不画光针。 */
export function planTodayOffset(startIso: string, now: Date): number | null {
  const today = localStartOfDay(now).getTime();
  const index = planDayDates(startIso).findIndex((day) => day.getTime() === today);
  return index >= 0 ? index : null;
}

/**
 * 接口错误一律读 body.error（customerApiError 的人话，A4 起都放在这里），读不到才用本地兜底文案。
 * 之前读 body.message，永远读不到，商家只看到「生成失败，请重试」。
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}
