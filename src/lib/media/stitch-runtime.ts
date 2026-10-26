/**
 * 成片合成运行时（C3：生产只有一套合成实现）—— 纯函数、零依赖。
 *
 *   STITCH_RUNTIME=inprocess  生产默认。合成跑在专用 Vercel 函数里
 *                             （/api/cron/stitch-dispatch 每分钟认领 + 进程内合成），
 *                             用的就是应用内那一套合成器（stitch-service + stitch-pipeline）。
 *                             用户请求与 poll-videos 里绝不内联合成，只把 FinalVideo 留在 PENDING。
 *   STITCH_RUNTIME=external   回滚路径：与 2026-10-25 之前完全一致——stitch-dispatch 派发
 *                             GitHub Actions runner（scripts/stitch-runner.ts）认领合成。
 *   STITCH_RUNTIME=local      开发：在触发它的请求 / 进程里直接合成（与 inprocess 同一合成器）。
 *
 * 未设置（或写错）时：NODE_ENV=production → inprocess，否则 → local。
 *
 * 所有判定运行时的地方（stitch-service / stitch-dispatch-service / 尾卡渲染器 /
 * 遗留 stitch-videos cron / 内部 claim 路由 / scripts/check-real-mode）都只从这里取，
 * 不再各自复制一份判定逻辑。
 */

export type StitchRuntimeMode = "inprocess" | "external" | "local";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

const EXPLICIT_ALIASES: Record<string, StitchRuntimeMode> = {
  inprocess: "inprocess",
  "in-process": "inprocess",
  in_process: "inprocess",
  external: "external",
  local: "local",
};

export function resolveStitchRuntimeMode(
  env: Env = process.env,
): StitchRuntimeMode {
  const explicit = (env.STITCH_RUNTIME ?? "").trim().toLowerCase();
  const mapped = EXPLICIT_ALIASES[explicit];
  if (mapped) return mapped;
  return env.NODE_ENV === "production" ? "inprocess" : "local";
}

/** 人读的来源说明（运维脚本 / 健康输出用） */
export function describeStitchRuntime(env: Env = process.env): {
  mode: StitchRuntimeMode;
  reason: string;
} {
  const explicit = (env.STITCH_RUNTIME ?? "").trim().toLowerCase();
  const mode = resolveStitchRuntimeMode(env);
  if (EXPLICIT_ALIASES[explicit]) {
    return { mode, reason: `STITCH_RUNTIME=${explicit} (explicit)` };
  }
  const suffix = explicit ? ` (unrecognised STITCH_RUNTIME=${explicit} ignored)` : "";
  return env.NODE_ENV === "production"
    ? { mode, reason: `NODE_ENV=production (default inprocess)${suffix}` }
    : { mode, reason: `non-production (default local)${suffix}` };
}
