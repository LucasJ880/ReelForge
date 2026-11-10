import { libraryDisplayTitle } from "@/lib/library/display-title";
import type { ExchangePulse } from "@/lib/exchange/pulse";

export type ReadyAnnouncement = {
  at: string;
  title: string;
  href: string;
  /** 商家正看着这条的详情页：成片自己会长出来，不用再弹一条提示（但基线照样前移）。 */
  silent: boolean;
};

/**
 * 要不要为「最近做好的一条」提示商家。纯函数，壳层的 useReadyAnnouncement 调它。
 * - 没有成片、或不比上次见到的新 → null
 * - 时刻都是服务端给的 UTC ISO 串（同一格式），直接比字符串
 */
export function nextReadyAnnouncement(
  latest: ExchangePulse["latestReady"],
  seenAt: string,
  pathname: string,
): ReadyAnnouncement | null {
  if (!latest || !(latest.at > seenAt)) return null;
  const href = `/app/library/${latest.id}`;
  return { at: latest.at, title: libraryDisplayTitle(latest.title, 18), href, silent: pathname === href };
}
