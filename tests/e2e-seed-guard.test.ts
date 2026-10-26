import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  databaseIdentity,
  decideE2eSeedTarget,
  E2E_SEED_CONFIRM,
  parseEnvFile,
  readProductionDatabaseUrls,
} from "./e2e/e2e-db-guard";

const execFileAsync = promisify(execFile);

/**
 * 2026-10-25 审计 B9：playwright.config.ts 的 webServer 带着 .env.local（= 生产库）跑视觉夹具种子，
 * 种子会 upsert 测试账号、强制激活风格模板。默认必须安全：只带 .env.local 跑 `npx playwright test`
 * 不能写生产库；只有专用 E2E 库，或与 db:* 同款的 CONFIRM_PRODUCTION_DB=e2e:seed 才放行。
 */

const PROD_POOLED = "postgresql://app_user:secret@ep-quiet-sun-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const PROD_OWNER = "postgresql://neondb_owner:other@ep-quiet-sun-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const E2E_BRANCH = "postgresql://app_user:secret@ep-e2e-branch-999999-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

test("只带 .env.local（生产库）：拒绝写库，并告诉人两条正路", () => {
  const decision = decideE2eSeedTarget({ DATABASE_URL: PROD_POOLED }, [PROD_POOLED, PROD_OWNER]);
  assert.equal(decision.ok, false);
  if (decision.ok) return;
  assert.match(decision.message, /E2E_DATABASE_URL=postgresql:\/\/…\/aivora_e2e npx playwright test/);
  assert.match(decision.message, new RegExp(`CONFIRM_PRODUCTION_DB=${E2E_SEED_CONFIRM} npx playwright test`));
});

test("确认闸与 db:* 脚本同一个写法：值必须正好是 e2e:seed", () => {
  assert.deepEqual(
    decideE2eSeedTarget({ DATABASE_URL: PROD_POOLED, CONFIRM_PRODUCTION_DB: "e2e:seed" }, [PROD_POOLED]),
    { ok: true, databaseUrl: PROD_POOLED, target: "confirmed-production" },
  );
  for (const wrong of ["db:seed", "true", "1", ""]) {
    assert.equal(decideE2eSeedTarget({ DATABASE_URL: PROD_POOLED, CONFIRM_PRODUCTION_DB: wrong }, [PROD_POOLED]).ok, false, wrong);
  }
});

test("专用 E2E 库：放行，并且就用它（不是 .env.local 的 DATABASE_URL）", () => {
  assert.deepEqual(
    decideE2eSeedTarget({ E2E_DATABASE_URL: ` ${E2E_BRANCH} `, DATABASE_URL: PROD_POOLED }, [PROD_POOLED, PROD_OWNER]),
    { ok: true, databaseUrl: E2E_BRANCH, target: "dedicated" },
  );
});

test("E2E_DATABASE_URL 其实就是生产库（换账号 / 走不走连接池都算）：拒绝", () => {
  for (const sneaky of [PROD_POOLED, PROD_OWNER, PROD_POOLED.replace("app_user:secret", "readonly:x")]) {
    const decision = decideE2eSeedTarget({ E2E_DATABASE_URL: sneaky }, [PROD_POOLED]);
    assert.equal(decision.ok, false, sneaky);
    if (!decision.ok) assert.match(decision.message, /就是 \.env\.local 里的生产库/);
  }
  /// 进程环境里显式标成生产的 owner 连接串也算生产（.env.local 不在的时候，例如 CI）
  assert.equal(decideE2eSeedTarget({ E2E_DATABASE_URL: PROD_OWNER, NEON_PRODUCTION_OWNER_DATABASE_URL: PROD_OWNER }, []).ok, false);
  /// 不是 postgres 连接串
  assert.equal(decideE2eSeedTarget({ E2E_DATABASE_URL: "mysql://localhost/x" }, []).ok, false);
});

test("数据库身份：主机去掉 -pooler + 端口 + 库名", () => {
  assert.equal(databaseIdentity(PROD_POOLED), "ep-quiet-sun-123456.us-east-2.aws.neon.tech:5432/neondb");
  assert.equal(databaseIdentity(PROD_OWNER), databaseIdentity(PROD_POOLED));
  assert.notEqual(databaseIdentity(E2E_BRANCH), databaseIdentity(PROD_POOLED));
  assert.equal(databaseIdentity("postgres://u@localhost:6543/aivora_e2e"), "localhost:6543/aivora_e2e");
  assert.equal(databaseIdentity("not a url"), null);
});

test(".env.local 解析：export / 引号 / 行尾注释", async () => {
  assert.deepEqual(
    parseEnvFile(`# 生产\nexport DATABASE_URL="${PROD_POOLED}"\nDIRECT_URL='${PROD_OWNER}'\nOTHER=1 # note\n\nBROKEN\n`),
    { DATABASE_URL: PROD_POOLED, DIRECT_URL: PROD_OWNER, OTHER: "1" },
  );
  const dir = await mkdtemp(path.join(os.tmpdir(), "aivora-e2e-guard-"));
  try {
    const file = path.join(dir, ".env.local");
    await writeFile(file, `DATABASE_URL=${PROD_POOLED}\nNEON_PRODUCTION_OWNER_DATABASE_URL=${PROD_OWNER}\nOPENAI_API_KEY=sk-test\n`);
    assert.deepEqual(readProductionDatabaseUrls(file), [PROD_POOLED, PROD_OWNER]);
    assert.deepEqual(readProductionDatabaseUrls(path.join(dir, "missing.env")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("真跑一次种子：没有专用库也没有确认 → 退出码 1、根本不去连库", async () => {
  /// 连接串指向一个不存在的主机：只要种子去连了库，报的就会是 Prisma 连接错误而不是闸的提示
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    DATABASE_URL: "postgresql://app_user:secret@prod-db.invalid:5432/neondb",
    E2E_LOGIN_EMAIL: "visual-qa@aivora.test",
    E2E_LOGIN_PASSWORD: "not-a-real-password",
  } as unknown as NodeJS.ProcessEnv;
  const run = execFileAsync(process.execPath, ["--import", "tsx", "tests/e2e/seed-visual-fixture.ts"], {
    cwd: process.cwd(),
    env,
    timeout: 60_000,
  });
  await assert.rejects(run, (error: { code?: number; stderr?: string }) => {
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /✋ \[visual-fixture\] 没有提供专用 E2E 库/);
    assert.doesNotMatch(String(error.stderr), /seed failed|PrismaClient|Can't reach database/);
    return true;
  });
});

test("接线：webServer 仍先跑种子（失败就不起 dev server），有专用库时种子与 dev server 都连它", async () => {
  const config = await readFile("playwright.config.ts", "utf8");
  assert.match(config, /"npx dotenv -e \.env\.local -- tsx tests\/e2e\/seed-visual-fixture\.ts && /);
  assert.match(config, /env: e2eDatabaseUrl \? \{ DATABASE_URL: e2eDatabaseUrl, DIRECT_URL: e2eDatabaseUrl \} : undefined,/);
  const seed = await readFile("tests/e2e/seed-visual-fixture.ts", "utf8");
  assert.doesNotMatch(seed, /^import \{ db \} from/m, "db 必须在过闸之后才动态 import");
  assert.ok(
    seed.indexOf("decideE2eSeedTarget(") < seed.indexOf('await import("../../src/lib/db")'),
    "先判定、后连库",
  );
});
