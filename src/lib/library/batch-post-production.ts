/**
 * 旧的批量成片的后期设置（字幕 / 配乐快照）：当年随模板快照一起存在 VideoJob.templateSnapshot 里。
 * 批量生产 2026-11-17 下线、代码已删；这个读取函数留着，是因为成品库和品牌封装还要照常显示、重新合成以前做的批量成片。
 * 加 `__` 前缀与模板自身字段区隔，读取方按 schema 校验，失败即视为没有后期。
 */
const BATCH_POST_PRODUCTION_KEY = "__batchPostProduction" as const;

export function readBatchPostProductionFromSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== "object") return null;
  return (snapshot as Record<string, unknown>)[BATCH_POST_PRODUCTION_KEY] ?? null;
}
