/**
 * Runway 灰度（2026-10-28 晚，docs/roadmap/2026-10-28-launch-review.md §6）。
 *
 * 本地与线上共用生产库，故事板出帧与视频轮询都由线上 cron 推进：Runway 链路只能部署后在生产上验。
 * 灰度名单里的账号先走 Runway（视频线路 + 故事板出图），其余客户照旧 Shuyu；
 * `VIDEO_CUSTOMER_ROUTE=runway` 时全员切换，名单失效。
 *
 * 名单 `RUNWAY_PILOT_ACCOUNTS`：邮箱或 user id，逗号分隔（同 GLOBAL_BRAND_PACKAGE_USERS 的写法）。
 * 没配 `RUNWAYML_API_SECRET` 时名单内账号的视频线路会按运行就绪检查降级回 Shuyu，故事板出图也留在 Shuyu。
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

/** 这个账号的客户视频线路该不该是 Runway（线路可用性另由运行就绪检查与降级决定）。 */
export function usesRunwayVideo(account: RolloutAccount | null | undefined, env: Env = process.env): boolean {
  return isRunwayGlobalRollout(env) || isRunwayPilotAccount(account, env);
}

/** 这个账号的故事板出图该不该走 Runway：与视频同一套灰度，且必须配了 key（没 key 就留在 Shuyu）。 */
export function usesRunwayStoryboardImages(account: RolloutAccount | null | undefined, env: Env = process.env): boolean {
  return usesRunwayVideo(account, env) && Boolean(runwayApiKey(env));
}
