/**
 * Phase 4 schema 验证脚本（只读 / SELECT-only）。
 *
 * 用途：
 *   - CI / 部署前快速自检数据库是否已 apply Phase 4 迁移
 *     （20260512_phase4_productization）。
 *   - 同时验证 Sunny Shutter 旧数据（segmentIndex IS NULL 的 VideoJob /
 *     finalVideoId IS NULL 的 VideoBrief）依然可读，没有被新字段破坏。
 *
 * 使用方法：
 *   npx dotenv -e .env.local -- npx tsx scripts/verify-phase4-schema.ts
 *
 * 安全约束：
 *   - 只执行 SELECT / information_schema 查询，绝不写库。
 *   - 任何 INSERT/UPDATE/DELETE 都属于越权，禁止添加。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: ["warn", "error"] });

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
};

type TableExists = { regclass: string | null };

type EnumRow = { enumlabel: string };

type ConstraintRow = {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
};

function mark(ok: boolean) {
  return ok ? "✅" : "❌";
}

function section(title: string) {
  console.log("\n" + "=".repeat(80));
  console.log(title);
  console.log("=".repeat(80));
}

async function checkTableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<TableExists[]>(
    `SELECT to_regclass($1)::text AS regclass`,
    `public."${name}"`,
  );
  return !!rows[0]?.regclass;
}

async function fetchColumns(tables: string[]): Promise<ColumnRow[]> {
  return prisma.$queryRawUnsafe<ColumnRow[]>(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    tables,
  );
}

async function fetchEnumValues(enumName: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<EnumRow[]>(
    `SELECT e.enumlabel
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder`,
    enumName,
  );
  return rows.map((r) => r.enumlabel);
}

async function fetchConstraints(tables: string[]): Promise<ConstraintRow[]> {
  return prisma.$queryRawUnsafe<ConstraintRow[]>(
    `SELECT tc.table_name, tc.constraint_name, tc.constraint_type
       FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name = ANY($1::text[])
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name, tc.constraint_name`,
    tables,
  );
}

function findCol(cols: ColumnRow[], table: string, name: string) {
  return cols.find((c) => c.table_name === table && c.column_name === name);
}

async function main() {
  section("A. 表存在性");
  const finalVideoExists = await checkTableExists("FinalVideo");
  const logoGenExists = await checkTableExists("LogoGeneration");
  console.log(`FinalVideo:      ${mark(finalVideoExists)}  exists=${finalVideoExists}`);
  console.log(`LogoGeneration:  ${mark(logoGenExists)}  exists=${logoGenExists}`);

  section("B. information_schema.columns (VideoBrief / VideoJob / FinalVideo / LogoGeneration)");
  const tables = ["VideoBrief", "VideoJob", "FinalVideo", "LogoGeneration"];
  const cols = await fetchColumns(tables);
  console.log(
    `${"table".padEnd(18)}${"column".padEnd(28)}${"type".padEnd(20)}${"nullable".padEnd(10)}default`,
  );
  console.log("-".repeat(100));
  for (const c of cols) {
    const type = c.udt_name === "_text" ? "text[]" : c.data_type;
    console.log(
      `${c.table_name.padEnd(18)}${c.column_name.padEnd(28)}${type.padEnd(20)}${c.is_nullable.padEnd(10)}${c.column_default ?? ""}`,
    );
  }

  section("C. 关键列校验");
  const checks: Array<{ label: string; ok: boolean; got: string }> = [];

  const vbTargetDur = findCol(cols, "VideoBrief", "targetDurationSec");
  checks.push({
    label: "VideoBrief.targetDurationSec INT NOT NULL DEFAULT 30",
    ok:
      !!vbTargetDur &&
      vbTargetDur.data_type === "integer" &&
      vbTargetDur.is_nullable === "NO" &&
      vbTargetDur.column_default?.startsWith("30") === true,
    got: vbTargetDur
      ? `${vbTargetDur.data_type} nullable=${vbTargetDur.is_nullable} default=${vbTargetDur.column_default}`
      : "MISSING",
  });

  const vbDirectorPlan = findCol(cols, "VideoBrief", "directorPlan");
  checks.push({
    label: "VideoBrief.directorPlan JSONB nullable",
    ok:
      !!vbDirectorPlan &&
      vbDirectorPlan.udt_name === "jsonb" &&
      vbDirectorPlan.is_nullable === "YES",
    got: vbDirectorPlan
      ? `${vbDirectorPlan.udt_name} nullable=${vbDirectorPlan.is_nullable}`
      : "MISSING",
  });

  const vbFinalVideoId = findCol(cols, "VideoBrief", "finalVideoId");
  checks.push({
    label: "VideoBrief.finalVideoId TEXT nullable",
    ok:
      !!vbFinalVideoId &&
      vbFinalVideoId.data_type === "text" &&
      vbFinalVideoId.is_nullable === "YES",
    got: vbFinalVideoId
      ? `${vbFinalVideoId.data_type} nullable=${vbFinalVideoId.is_nullable}`
      : "MISSING",
  });

  const vjSegIdx = findCol(cols, "VideoJob", "segmentIndex");
  checks.push({
    label: "VideoJob.segmentIndex INT nullable",
    ok:
      !!vjSegIdx &&
      vjSegIdx.data_type === "integer" &&
      vjSegIdx.is_nullable === "YES",
    got: vjSegIdx
      ? `${vjSegIdx.data_type} nullable=${vjSegIdx.is_nullable}`
      : "MISSING",
  });

  const vjSegDur = findCol(cols, "VideoJob", "segmentDurationSec");
  checks.push({
    label: "VideoJob.segmentDurationSec INT nullable",
    ok:
      !!vjSegDur &&
      vjSegDur.data_type === "integer" &&
      vjSegDur.is_nullable === "YES",
    got: vjSegDur
      ? `${vjSegDur.data_type} nullable=${vjSegDur.is_nullable}`
      : "MISSING",
  });

  const vjFinalVideoId = findCol(cols, "VideoJob", "finalVideoId");
  checks.push({
    label: "VideoJob.finalVideoId TEXT nullable",
    ok:
      !!vjFinalVideoId &&
      vjFinalVideoId.data_type === "text" &&
      vjFinalVideoId.is_nullable === "YES",
    got: vjFinalVideoId
      ? `${vjFinalVideoId.data_type} nullable=${vjFinalVideoId.is_nullable}`
      : "MISSING",
  });

  for (const c of checks) {
    console.log(`${mark(c.ok)} ${c.label.padEnd(54)} → got: ${c.got}`);
  }

  section("D. FOREIGN KEY 约束（VideoBrief / VideoJob → FinalVideo, LogoGeneration → DeliveryOrder）");
  const fks = await fetchConstraints([
    "VideoBrief",
    "VideoJob",
    "LogoGeneration",
  ]);
  for (const fk of fks) {
    console.log(`- ${fk.table_name}.${fk.constraint_name}  (${fk.constraint_type})`);
  }
  const hasVbFk = fks.some(
    (f) => f.table_name === "VideoBrief" && f.constraint_name === "VideoBrief_finalVideoId_fkey",
  );
  const hasVjFk = fks.some(
    (f) => f.table_name === "VideoJob" && f.constraint_name === "VideoJob_finalVideoId_fkey",
  );
  const hasLogoFk = fks.some(
    (f) =>
      f.table_name === "LogoGeneration" &&
      f.constraint_name === "LogoGeneration_deliveryOrderId_fkey",
  );
  console.log(`\n${mark(hasVbFk)}  VideoBrief_finalVideoId_fkey`);
  console.log(`${mark(hasVjFk)}  VideoJob_finalVideoId_fkey`);
  console.log(`${mark(hasLogoFk)}  LogoGeneration_deliveryOrderId_fkey`);

  section("E. enum FinalVideoStatus");
  const expectedEnum = ["PENDING", "STITCHING", "READY", "FAILED"];
  let enumValues: string[] = [];
  try {
    enumValues = await fetchEnumValues("FinalVideoStatus");
  } catch (e) {
    enumValues = [];
  }
  const enumOk =
    enumValues.length === expectedEnum.length &&
    expectedEnum.every((v) => enumValues.includes(v));
  console.log(`expected: ${expectedEnum.join(", ")}`);
  console.log(`actual:   ${enumValues.length ? enumValues.join(", ") : "(enum not found)"}`);
  console.log(`${mark(enumOk)} FinalVideoStatus enum`);

  section("F. Sunny Shutter 兼容样本（只读）");
  // 注意：如果 segmentIndex 列不存在，下面查询会失败 — 用 try / catch 兜底
  type VjRow = {
    id: string;
    videoBriefId: string;
    segmentIndex: number | null;
    outputVideoUrl: string | null;
    status: string;
  };
  type VbRow = {
    id: string;
    finalVideoUrl: string | null;
    finalVideoId: string | null;
    targetDurationSec: number | null;
    status: string;
  };

  console.log("\n[F.1] VideoJob (segmentIndex IS NULL) LIMIT 5");
  try {
    const vjRows = await prisma.$queryRawUnsafe<VjRow[]>(
      `SELECT id, "videoBriefId", "segmentIndex", "outputVideoUrl", "status"
         FROM "VideoJob"
        WHERE "segmentIndex" IS NULL
        ORDER BY "createdAt" DESC
        LIMIT 5`,
    );
    if (vjRows.length === 0) {
      console.log("(no rows — 该库没有旧的单段 VideoJob)");
    } else {
      console.log(
        `${"id".padEnd(28)}${"briefId".padEnd(28)}${"segIdx".padEnd(8)}${"status".padEnd(12)}outputUrl`,
      );
      for (const r of vjRows) {
        console.log(
          `${r.id.padEnd(28)}${r.videoBriefId.padEnd(28)}${String(r.segmentIndex ?? "NULL").padEnd(8)}${r.status.padEnd(12)}${r.outputVideoUrl ?? ""}`,
        );
      }
      const validStatuses = new Set([
        "QUEUED",
        "RUNNING",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
      ]);
      const bad = vjRows.filter((r) => !validStatuses.has(r.status));
      console.log(
        `\n${mark(bad.length === 0)} 所有 status 落在合法集（QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED）: ${bad.length} bad row(s)`,
      );
    }
  } catch (err) {
    console.log(`❌ 查询失败：${(err as Error).message}`);
    console.log(
      "  → 这通常意味着 segmentIndex 列还没在 DB 里（Phase 4 迁移未 apply）",
    );
  }

  console.log("\n[F.2] VideoBrief (finalVideoId IS NULL AND finalVideoUrl IS NOT NULL) LIMIT 5");
  try {
    const vbRows = await prisma.$queryRawUnsafe<VbRow[]>(
      `SELECT id, "finalVideoUrl", "finalVideoId", "targetDurationSec", "status"
         FROM "VideoBrief"
        WHERE "finalVideoId" IS NULL
          AND "finalVideoUrl" IS NOT NULL
        ORDER BY "updatedAt" DESC
        LIMIT 5`,
    );
    if (vbRows.length === 0) {
      console.log("(no rows — 该库没有已完成 finalVideoUrl 的旧 brief)");
    } else {
      console.log(
        `${"id".padEnd(28)}${"targetDur".padEnd(12)}${"status".padEnd(22)}finalVideoUrl`,
      );
      for (const r of vbRows) {
        console.log(
          `${r.id.padEnd(28)}${String(r.targetDurationSec ?? "NULL").padEnd(12)}${r.status.padEnd(22)}${r.finalVideoUrl ?? ""}`,
        );
      }
    }
  } catch (err) {
    console.log(`❌ 查询失败：${(err as Error).message}`);
    console.log(
      "  → 这通常意味着 finalVideoId / targetDurationSec 列还没在 DB 里（Phase 4 迁移未 apply）",
    );
  }

  section("G. 综合判断");
  const allChecks = [
    finalVideoExists,
    logoGenExists,
    ...checks.map((c) => c.ok),
    hasVbFk,
    hasVjFk,
    hasLogoFk,
    enumOk,
  ];
  const passed = allChecks.filter(Boolean).length;
  const total = allChecks.length;
  const verdict = passed === total ? "PHASE_4_APPLIED" : "PHASE_4_NOT_APPLIED";
  console.log(`通过：${passed}/${total}`);
  console.log(`结论：${verdict}`);
  if (verdict === "PHASE_4_NOT_APPLIED") {
    console.log(
      "\n→ 建议（不在脚本里自动执行）：",
    );
    console.log("    npx dotenv -e .env.local -- npx prisma migrate deploy");
    console.log(
      "  migration SQL 已用 IF NOT EXISTS / duplicate_object catch，重复跑安全；",
    );
    console.log("  但仍建议先在 staging 验证，并提前备份。");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
