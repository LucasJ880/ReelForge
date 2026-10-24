import type { LeadStatusKey } from "@/i18n/growth-copy";

export type LeadMilestone = { status: "WON" | "BOOKED" | "CONTACTED"; at: string };

/**
 * 询盘时间列下面那一行「已联系 / 已预约 / 已成交 + 时间」：只写当前状态走到过、且仍然成立的那一步。
 *
 * 状态流转时服务端只补时间戳、从不清旧的（leadStatusTransitionData 有意如此，留痕）。
 * 之前这里不看当前状态、谁有值先写谁：误点「已成交」再改回「未成交」，状态记号写「× 未成交」，
 * 时间列却还挂着绿色「已成交 10/24」——「成交」是询盘专用词，不能和状态打架。
 *
 * 规则：按 新询盘 → 已联系 → 已预约 → 已成交 的顺序，只取不超过当前状态的最高一步；
 * 新询盘与未成交不写里程碑。
 */
export function leadMilestone(lead: {
  status: LeadStatusKey;
  contactedAt: string | null;
  bookedAt: string | null;
  wonAt: string | null;
}): LeadMilestone | null {
  const { status } = lead;
  if (status === "WON" && lead.wonAt) return { status: "WON", at: lead.wonAt };
  if ((status === "WON" || status === "BOOKED") && lead.bookedAt) return { status: "BOOKED", at: lead.bookedAt };
  if ((status === "WON" || status === "BOOKED" || status === "CONTACTED") && lead.contactedAt) {
    return { status: "CONTACTED", at: lead.contactedAt };
  }
  return null;
}
