/**
 * 授权配乐署名（CC BY 4.0）。
 *
 * 曲库目前只有 Kevin MacLeod 的「Wholesome」（audio-post-production 的 BGM_TRACKS），
 * CC BY 4.0 要求发布方随作品署名：成片里混了这首曲子，商家发广告时就得带上这一行。
 * 所以交付面（成品库详情 / 下载处、对外 API 的成片描述）要把它原样交给客户，
 * 选曲处也要提前说清楚。
 *
 * 纯数据 + 纯函数，只引类型：'use client' 组件和服务端都能安全 import。
 */
import type { BgmTrackId } from "@/types/video-generation";

/// 署名按 CC 推荐的 TASL（标题 / 作者 / 来源 / 许可 + 链接）写成一行，方便直接贴进帖子文案。
export const BGM_ATTRIBUTIONS: Readonly<Partial<Record<BgmTrackId, string>>> = {
  wholesome:
    "\"Wholesome\" by Kevin MacLeod (incompetech.com), licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/",
};

/** 曲目需要署名时返回署名行；不需要（none / 未知曲目）返回 null。 */
export function bgmAttributionForTrack(
  trackId: string | null | undefined,
): string | null {
  /// hasOwn：快照来自数据库 JSON，"constructor" 之类的原型键不能被当成曲目
  if (!trackId || !Object.hasOwn(BGM_ATTRIBUTIONS, trackId)) return null;
  return BGM_ATTRIBUTIONS[trackId as BgmTrackId] ?? null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 从成片的后期快照读出需要随交付附上的配乐署名。
 *
 * 入参就是落库的快照 JSON：单条走 `FinalVideo.postProduction`，批量走
 * `VideoJob.templateSnapshot` 里的批次后期（形状同为 `{ audio: { bgm: { trackId, volume } } }`）。
 * 只有曲目需要署名且音量 > 0 才算真的混进了成片——与 stitch-service 的 bgmEnabled
 * 同口径；读不懂的快照一律返回 null，不猜。
 */
export function bgmAttributionFor(postProduction: unknown): string | null {
  const bgm = record(record(record(postProduction)?.audio)?.bgm);
  if (!bgm) return null;
  const volume = bgm.volume;
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0) {
    return null;
  }
  return typeof bgm.trackId === "string"
    ? bgmAttributionForTrack(bgm.trackId)
    : null;
}
