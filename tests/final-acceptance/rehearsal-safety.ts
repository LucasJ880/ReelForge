export interface FinalAcceptanceRehearsalEnv {
  FINAL_ACCEPTANCE_REQUIRE_REHEARSAL?: string;
  DATABASE_URL?: string;
  NEON_REHEARSAL_DATABASE_URL?: string;
}

/**
 * Destructive acceptance-fixture cleanup is allowed only on the explicitly
 * selected Neon rehearsal branch. A missing flag is a refusal, not a fallback.
 */
export function assertFinalAcceptanceRehearsal(
  env: FinalAcceptanceRehearsalEnv = {
    FINAL_ACCEPTANCE_REQUIRE_REHEARSAL:
      process.env.FINAL_ACCEPTANCE_REQUIRE_REHEARSAL,
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_REHEARSAL_DATABASE_URL: process.env.NEON_REHEARSAL_DATABASE_URL,
  },
): string {
  if (env.FINAL_ACCEPTANCE_REQUIRE_REHEARSAL !== "true") {
    throw new Error(
      "最终验收种子只允许在显式 rehearsal 模式运行",
    );
  }
  const databaseUrl = env.DATABASE_URL;
  const rehearsalDatabaseUrl = env.NEON_REHEARSAL_DATABASE_URL;
  if (!databaseUrl || !rehearsalDatabaseUrl) {
    throw new Error("最终验收缺少演练分支数据库配置");
  }
  if (databaseUrl !== rehearsalDatabaseUrl) {
    throw new Error(
      "最终验收 DATABASE_URL 必须与 NEON_REHEARSAL_DATABASE_URL 完全一致",
    );
  }
  return databaseUrl;
}
