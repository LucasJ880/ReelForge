/**
 * Runway 线路的三种用法（2026-10-29 Evan：Shuyu 作所有客户的默认线路，便宜；Runway 作更高质量的备选；
 * Shuyu 生成失败再换 Runway）。三种都要配了 `RUNWAYML_API_SECRET` 才生效。
 *
 * 1. 全员切换 `VIDEO_CUSTOMER_ROUTE=runway`：运维急用开关，所有客户的默认线路改成 Runway（故事板出图同切）。
 * 2. 高质量选项：客户在创作台主动选「高质量」时这一条走 Runway。`RUNWAY_PREMIUM=off` 全关，
 *    `=pilot` 只给灰度名单 `RUNWAY_PILOT_ACCOUNTS`（邮箱或 user id，逗号分隔），缺省对所有客户开放。
 * 3. 失败改交：Shuyu 明确失败（当场拒单 / 退回积分）且整条视频没有能用的段时改交 Runway 重拍
 *    （判据见 runway-fallback.ts）。`SHUYU_FALLBACK_TO_RUNWAY=off` 关，缺省开。
 *
 * 10-28 的灰度名单原本让名单里的账号默认走 Runway；10-29 起默认一律 Shuyu，名单只管 `RUNWAY_PREMIUM=pilot`
 * 时谁能选高质量，以及名单账号的故事板出图走不走 Runway（与 10-28 一致）。
 * 本地与线上共用生产库，故事板出帧与视频轮询都由线上 cron 推进：Runway 链路只能部署后在生产上验。
 */
import { runwayApiKey } from "@/lib/providers/runway";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface RolloutAccount {
  userId?: string | null;
  email?: string | null;
}

export function runwayPilotAccounts(env: Env = process.env): string[] {
  return (env.RUNWAY_PILOT_ACCOUNTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.includes("@") ? value.toLowerCase() : value));
}

export function isRunwayGlobalRollout(env: Env = process.env): boolean {
  return env.VIDEO_CUSTOMER_ROUTE?.trim().toLowerCase() === "runway";
}

export function isRunwayPilotAccount(account: RolloutAccount | null | undefined, env: Env = process.env): boolean {
  if (!account) return false;
  const pilots = runwayPilotAccounts(env);
  if (pilots.length === 0) return false;
  if (account.userId && pilots.includes(account.userId)) return true;
  const email = account.email?.trim().toLowerCase();
  return Boolean(email && pilots.includes(email));
}

/** 客户默认视频线路是不是 Runway：只看全员开关（10-29 起 Shuyu 是所有人的默认线路，灰度名单不再改默认）。 */
export function usesRunwayVideo(env: Env = process.env): boolean {
  return isRunwayGlobalRollout(env);
}

export type RunwayPremiumMode = "off" | "pilot" | "on";

export function runwayPremiumMode(env: Env = process.env): RunwayPremiumMode {
  const raw = env.RUNWAY_PREMIUM?.trim().toLowerCase();
  return raw === "off" || raw === "pilot" ? raw : "on";
}

/** 这个账号能不能选「高质量（Runway）」：配了 key，且开关对它开放。 */
export function canChooseRunwayPremium(account: RolloutAccount | null | undefined, env: Env = process.env): boolean {
  if (!runwayApiKey(env)) return false;
  const mode = runwayPremiumMode(env);
  return mode === "on" || (mode === "pilot" && isRunwayPilotAccount(account, env));
}

/** Shuyu 明确失败后改交 Runway 的开关：缺省开，配了 key 才算数。 */
export function shuyuFallbackToRunwayEnabled(env: Env = process.env): boolean {
  return env.SHUYU_FALLBACK_TO_RUNWAY?.trim().toLowerCase() !== "off" && Boolean(runwayApiKey(env));
}

/** 这个账号的故事板出图该不该走 Runway：全员开关或灰度名单（与 10-28 一致），且必须配了 key（没 key 就留在 Shuyu）。 */
export function usesRunwayStoryboardImages(account: RolloutAccount | null | undefined, env: Env = process.env): boolean {
  return (isRunwayGlobalRollout(env) || isRunwayPilotAccount(account, env)) && Boolean(runwayApiKey(env));
}
