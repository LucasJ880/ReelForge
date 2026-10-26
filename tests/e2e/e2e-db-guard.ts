import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Playwright 视觉夹具的生产库闸（2026-10-25 审计 B9）。
 *
 * `.env.local` 就是生产库（CLAUDE.md §4）。playwright.config.ts 的 webServer 以前会带着它跑
 * tests/e2e/seed-visual-fixture.ts：upsert 测试账号、把一个风格模板强制置为 ACTIVE——
 * 只要有人顺手跑一次 `npx playwright test`，就是在生产库里写数据。
 *
 * 现在默认拒绝，只有两条路能写：
 *  1. 提供专用 E2E 库 `E2E_DATABASE_URL`（且不能就是 .env.local 里的生产库）：种子与 dev server 都连它；
 *  2. 与 db:* 脚本同一个确认闸：`CONFIRM_PRODUCTION_DB=e2e:seed`，明确知道自己在写生产库。
 * 其余情况种子退出码 1、一行都不写，webServer 随之起不来，测试也就不会对着生产库跑。
 */
export const E2E_SEED_CONFIRM = "e2e:seed";

/** .env.local 里可能指向生产库的连接串。 */
export const PRODUCTION_DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_PRODUCTION_OWNER_DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

export type E2eSeedTarget =
  | { ok: true; databaseUrl: string; target: "dedicated" | "confirmed-production" }
  | { ok: false; message: string };

/**
 * 数据库身份：主机（去掉 Neon 连接池的 `-pooler` 后缀）+ 端口 + 库名。
 * 换个账号、走不走连接池，指向的都是同一个库——都算生产。不是 postgres 连接串返回 null。
 */
export function databaseIdentity(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    const host = parsed.hostname.toLowerCase().replace(/-pooler(?=\.|$)/, "");
    if (!host) return null;
    const port = parsed.port || "5432";
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "postgres";
    return `${host}:${port}/${database}`;
  } catch {
    return null;
  }
}

/** 只认 `KEY=value` / `export KEY="value"` 两种写法；够读连接串，不引第三方依赖。 */
export function parseEnvFile(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    out[key] = value;
  }
  return out;
}

/** .env.local（= 生产库）里登记的数据库连接串；没有这个文件就是空表。 */
export function readProductionDatabaseUrls(
  envFile = path.resolve(process.cwd(), ".env.local"),
): string[] {
  if (!existsSync(envFile)) return [];
  const parsed = parseEnvFile(readFileSync(envFile, "utf8"));
  return PRODUCTION_DATABASE_URL_KEYS.map((key) => parsed[key]?.trim()).filter(
    (value): value is string => Boolean(value),
  );
}

function refusal(reason: string): string {
  return [
    `✋ [visual-fixture] ${reason}`,
    "  .env.local = 生产库：视觉夹具会 upsert 测试账号并把风格模板强制置为 ACTIVE，默认不对它执行。",
    "  用专用 E2E 库跑（种子与 dev server 都会连它）：",
    "    E2E_DATABASE_URL=postgresql://…/aivora_e2e npx playwright test",
    "  确实要写生产库（与 db:* 脚本同一个确认闸）：",
    `    CONFIRM_PRODUCTION_DB=${E2E_SEED_CONFIRM} npx playwright test`,
  ].join("\n");
}

/**
 * 决定视觉夹具写哪个库（纯函数，便于单测）。
 * env 是种子进程的环境；productionUrls 是 .env.local 里登记的生产连接串。
 */
export function decideE2eSeedTarget(
  env: Record<string, string | undefined>,
  productionUrls: readonly string[],
): E2eSeedTarget {
  const dedicated = env.E2E_DATABASE_URL?.trim();
  if (!dedicated) {
    const current = env.DATABASE_URL?.trim();
    if (env.CONFIRM_PRODUCTION_DB === E2E_SEED_CONFIRM && current) {
      return { ok: true, databaseUrl: current, target: "confirmed-production" };
    }
    return { ok: false, message: refusal("没有提供专用 E2E 库（E2E_DATABASE_URL），拒绝写库。") };
  }

  const identity = databaseIdentity(dedicated);
  if (!identity) {
    return { ok: false, message: refusal("E2E_DATABASE_URL 不是 postgres:// 连接串。") };
  }
  const production = new Set(
    [...productionUrls, env.NEON_PRODUCTION_OWNER_DATABASE_URL ?? ""]
      .map((url) => (url ? databaseIdentity(url.trim()) : null))
      .filter((value): value is string => Boolean(value)),
  );
  if (production.has(identity)) {
    return {
      ok: false,
      message: refusal("E2E_DATABASE_URL 指向的就是 .env.local 里的生产库，这不是专用 E2E 库。"),
    };
  }
  return { ok: true, databaseUrl: dedicated, target: "dedicated" };
}
