import assert from "node:assert/strict";
import test from "node:test";
import {
  RehearsalGuardError,
  assertRehearsalDatabase,
  neonEndpointOf,
} from "../scripts/lib/rehearsal-guard";

/**
 * X-SCAF-5：会写库的演练脚本只能落在 Neon 演练分支。
 * 旧门禁只看 host 含 `us-east-1.aws.neon.tech`，生产与演练同区域，等于没拦。
 * 这里不连库、不读 process.env，只验纯函数的判定。
 */

const REHEARSAL = "postgresql://aivora_phase4_rehearsal:reh-secret-pw@ep-shiny-silence-123456.us-east-1.aws.neon.tech/neondb?sslmode=require";
const REHEARSAL_POOLER = "postgresql://aivora_phase4_rehearsal:reh-secret-pw@ep-shiny-silence-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const PRODUCTION_OWNER = "postgresql://neondb_owner:prod-owner-secret-pw@ep-steep-river-654321.us-east-1.aws.neon.tech/neondb?sslmode=require";
const PRODUCTION_APP_POOLER = "postgresql://aivora_app:prod-app-secret-pw@ep-steep-river-654321-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";

function rejects(input: Parameters<typeof assertRehearsalDatabase>[0], pattern: RegExp) {
  assert.throws(
    () => assertRehearsalDatabase(input),
    (error: unknown) => {
      assert.ok(error instanceof RehearsalGuardError, "必须抛 RehearsalGuardError，调用方据此直接退出");
      assert.match(error.message, pattern);
      /// 错误信息只带主机名，绝不带口令
      assert.doesNotMatch(error.message, /secret-pw/);
      return true;
    },
  );
}

test("生产 URL 被拒：DATABASE_URL 指向生产 owner 端点", () => {
  rejects(
    { databaseUrl: PRODUCTION_OWNER, rehearsalUrl: REHEARSAL, productionOwnerUrl: PRODUCTION_OWNER },
    /指向生产库端点/,
  );
});

test("生产 URL 被拒：pooler 版的生产应用连接串也认得出来（同一个 Neon 端点）", () => {
  rejects(
    { databaseUrl: PRODUCTION_APP_POOLER, rehearsalUrl: REHEARSAL, productionOwnerUrl: PRODUCTION_OWNER },
    /指向生产库端点/,
  );
});

test("第三方主机被拒：既不是演练也不是生产（同区域的别的 Neon 分支）", () => {
  rejects(
    {
      databaseUrl: "postgresql://u:p@ep-other-branch-000000.us-east-1.aws.neon.tech/neondb",
      rehearsalUrl: REHEARSAL,
      productionOwnerUrl: PRODUCTION_OWNER,
    },
    /不是演练库/,
  );
});

test("演练 URL 放行：返回演练库连接串与主机名，脚本用它显式建 Prisma client", () => {
  const ok = assertRehearsalDatabase({
    databaseUrl: REHEARSAL,
    rehearsalUrl: REHEARSAL,
    productionOwnerUrl: PRODUCTION_OWNER,
  });
  assert.equal(ok.url, REHEARSAL);
  assert.equal(ok.host, "ep-shiny-silence-123456.us-east-1.aws.neon.tech");
  assert.equal(ok.endpoint, "ep-shiny-silence-123456.us-east-1.aws.neon.tech");
});

test("演练 URL 放行：DATABASE_URL 用 pooler 入口、NEON_REHEARSAL 用直连，仍是同一个演练端点", () => {
  const ok = assertRehearsalDatabase({
    databaseUrl: REHEARSAL_POOLER,
    rehearsalUrl: REHEARSAL,
    productionOwnerUrl: PRODUCTION_OWNER,
  });
  /// 返回的是 NEON_REHEARSAL_DATABASE_URL 本身，不是调用方传的 DATABASE_URL
  assert.equal(ok.url, REHEARSAL);
});

test("缺 env 被拒：三个坐标缺任何一个都不放行", () => {
  rejects(
    { databaseUrl: REHEARSAL, rehearsalUrl: undefined, productionOwnerUrl: PRODUCTION_OWNER },
    /NEON_REHEARSAL_DATABASE_URL 未设置/,
  );
  rejects(
    { databaseUrl: REHEARSAL, rehearsalUrl: REHEARSAL, productionOwnerUrl: undefined },
    /NEON_PRODUCTION_OWNER_DATABASE_URL 未设置/,
  );
  rejects(
    { databaseUrl: undefined, rehearsalUrl: REHEARSAL, productionOwnerUrl: PRODUCTION_OWNER },
    /DATABASE_URL 未设置/,
  );
  rejects({ databaseUrl: "", rehearsalUrl: REHEARSAL, productionOwnerUrl: PRODUCTION_OWNER }, /DATABASE_URL 未设置/);
});

test("env 自相矛盾被拒：演练与生产是同一个端点", () => {
  rejects(
    { databaseUrl: PRODUCTION_OWNER, rehearsalUrl: PRODUCTION_OWNER, productionOwnerUrl: PRODUCTION_APP_POOLER },
    /同一个端点/,
  );
});

test("连接串格式不对被拒，而不是当成「不是生产」放行", () => {
  rejects(
    { databaseUrl: "not a url", rehearsalUrl: REHEARSAL, productionOwnerUrl: PRODUCTION_OWNER },
    /DATABASE_URL 不是合法的连接串/,
  );
});

test("Neon 端点身份：只去第一段的 -pooler 后缀，大小写不敏感", () => {
  assert.equal(neonEndpointOf("EP-Foo-Pooler.us-east-1.aws.neon.tech"), "ep-foo.us-east-1.aws.neon.tech");
  assert.equal(neonEndpointOf("ep-foo.us-east-1.aws.neon.tech"), "ep-foo.us-east-1.aws.neon.tech");
  assert.equal(neonEndpointOf("localhost"), "localhost");
});
