/**
 * 发布登记：同一条成片只能登记给一个账号（防矩阵号之间发同一条片）。
 * 用内存 store 跑服务层真实逻辑，不连数据库。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PublishStatus } from "@prisma/client";
import {
  accountLabelKey,
  cancelPlatformPublish,
  decidePublishRegistration,
  PublishAccountConflictError,
  PublishRegistrationInputError,
  registerPlatformPublish,
  type PublishRegistrationRow,
  type PublishRegistrationStore,
} from "../src/lib/services/publish-service";

function memoryStore() {
  const rows: Array<PublishRegistrationRow & { videoBriefId: string }> = [];
  let locks = 0;
  /// 与生产的事务级咨询锁同一个语义：同一把锁上的调用排队执行
  let queue: Promise<unknown> = Promise.resolve();
  const store: PublishRegistrationStore = {
    async withBriefLock(_videoBriefId, _platform, fn) {
      locks += 1;
      const run = queue.then(() => fn({
        list: async (videoBriefId, platform) =>
          rows.filter((row) => row.videoBriefId === videoBriefId && row.platform === platform),
        create: async (data) => {
          const row = {
            id: `pr_${rows.length + 1}`,
            videoBriefId: data.videoBriefId,
            platform: data.platform,
            accountLabel: data.accountLabel,
            status: data.status,
            publishUrl: data.publishUrl,
            externalPostId: data.externalPostId,
            operatorNote: data.operatorNote,
            publishedAt: data.publishedAt,
            createdAt: new Date(2026, 10, 9, 12, rows.length),
          };
          rows.push(row);
          return row;
        },
        update: async (id, data) => {
          const row = rows.find((candidate) => candidate.id === id);
          if (!row) throw new Error("row missing");
          Object.assign(row, Object.fromEntries(Object.entries(data).filter(([key]) => key !== "publishedById")));
          return row;
        },
      }));
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return { store, rows, lockCount: () => locks };
}

const brief = "brief_1";

test("[publish] 第二个不同账号登记同一条成片 → 明确拒绝，并说出已登记给谁", async () => {
  const { store, rows } = memoryStore();
  const first = await registerPlatformPublish(
    { videoBriefId: brief, platform: "douyin", accountLabel: "Aivora 好物号 01" },
    store,
  );
  assert.equal(first.created, true);
  assert.equal(first.record.platform, "douyin");
  assert.equal(first.record.accountLabel, "Aivora 好物号 01");

  await assert.rejects(
    registerPlatformPublish({ videoBriefId: brief, platform: "douyin", accountLabel: "Aivora 好物号 02" }, store),
    (err: unknown) => {
      assert.ok(err instanceof PublishAccountConflictError);
      assert.equal(err.code, "PUBLISH_ACCOUNT_CONFLICT");
      assert.equal(err.existingAccountLabel, "Aivora 好物号 01");
      assert.match(err.message, /已登记给账号「Aivora 好物号 01」/);
      assert.match(err.message, /只能发一个账号/);
      return true;
    },
  );
  /// 被拒绝的登记不留任何行
  assert.equal(rows.length, 1);
});

test("[publish] 同一个账号重复登记是幂等的：更新那一行（补链接），不新建", async () => {
  const { store, rows } = memoryStore();
  await registerPlatformPublish({ videoBriefId: brief, platform: "douyin", accountLabel: "Aivora好物" }, store);
  assert.equal(rows[0].status, PublishStatus.UPLOADED);
  const again = await registerPlatformPublish(
    {
      videoBriefId: brief,
      platform: "douyin",
      /// @ 前缀、大小写、多余空白都算同一个号
      accountLabel: "  @AIVORA好物 ",
      publishUrl: "https://www.douyin.com/video/7300000000000000000",
      now: new Date("2026-11-09T08:00:00Z"),
    },
    store,
  );
  assert.equal(again.created, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, PublishStatus.PUBLISHED);
  assert.equal(rows[0].publishUrl, "https://www.douyin.com/video/7300000000000000000");
  assert.equal(rows[0].publishedAt?.toISOString(), "2026-11-09T08:00:00.000Z");
});

test("[publish] 撤销登记后可以改登记给别的账号；撤销只改状态，行保留", async () => {
  const { store, rows } = memoryStore();
  await registerPlatformPublish({ videoBriefId: brief, platform: "douyin", accountLabel: "号 A" }, store);
  const cancelled = await cancelPlatformPublish({ videoBriefId: brief, platform: "douyin" }, store);
  assert.deepEqual(cancelled, { cancelled: 1 });
  assert.equal(rows[0].status, PublishStatus.CANCELLED);
  assert.equal(rows[0].accountLabel, "号 A");

  const next = await registerPlatformPublish({ videoBriefId: brief, platform: "douyin", accountLabel: "号 B" }, store);
  assert.equal(next.created, true);
  assert.equal(rows.length, 2);
  /// 再撤销一次空的也是幂等
  await cancelPlatformPublish({ videoBriefId: brief, platform: "douyin" }, store);
  assert.deepEqual(await cancelPlatformPublish({ videoBriefId: brief, platform: "douyin" }, store), { cancelled: 0 });
});

test("[publish] 规则按「成片 + 平台」生效：别的成片、别的平台互不影响", async () => {
  const { store } = memoryStore();
  await registerPlatformPublish({ videoBriefId: brief, platform: "douyin", accountLabel: "号 A" }, store);
  await registerPlatformPublish({ videoBriefId: "brief_2", platform: "douyin", accountLabel: "号 B" }, store);
  await registerPlatformPublish({ videoBriefId: brief, platform: "tiktok", accountLabel: "号 B" }, store);
});

test("[publish] 登记在按成片加锁的互斥区里做（两个号同时登记只会成一个）", async () => {
  const { store, rows, lockCount } = memoryStore();
  const results = await Promise.allSettled([
    registerPlatformPublish({ videoBriefId: brief, platform: "douyin", accountLabel: "号 A" }, store),
    registerPlatformPublish({ videoBriefId: brief, platform: "douyin", accountLabel: "号 B" }, store),
  ]);
  assert.equal(lockCount(), 2);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(rows.length, 1);
  /// 生产实现用事务级咨询锁（随事务释放，过连接池不泄漏）
  const source = readFileSync("src/lib/services/publish-service.ts", "utf8");
  /// 必须是 $executeRaw：该函数返回 void，$queryRaw 会在反序列化时抛 P2010（真库验收踩到过）
  assert.match(source, /tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(/);
  assert.doesNotMatch(source, /\$queryRaw`SELECT pg_advisory_xact_lock/);
  assert.doesNotMatch(source, /pg_advisory_lock\(/);
});

test("[publish] 账号标签为空 / 过长 → 输入错误，不触库", async () => {
  const { store, lockCount } = memoryStore();
  for (const accountLabel of ["", "   ", "@", "号".repeat(61)]) {
    await assert.rejects(
      registerPlatformPublish({ videoBriefId: brief, platform: "douyin", accountLabel }, store),
      PublishRegistrationInputError,
    );
  }
  assert.equal(lockCount(), 0);
});

test("[publish] 纯决策：历史行没有账号标签时一律拒绝；失败 / 已撤销的行不占位", () => {
  assert.deepEqual(decidePublishRegistration([], "号 A"), { action: "create" });
  assert.deepEqual(
    decidePublishRegistration([{ id: "1", accountLabel: null, status: PublishStatus.PUBLISHED }], "号 A"),
    { action: "reject", existingAccountLabel: "未标注账号" },
  );
  assert.deepEqual(
    decidePublishRegistration(
      [
        { id: "1", accountLabel: "号 B", status: PublishStatus.CANCELLED },
        { id: "2", accountLabel: "号 C", status: PublishStatus.FAILED },
      ],
      "号 A",
    ),
    { action: "create" },
  );
  assert.deepEqual(
    decidePublishRegistration([{ id: "9", accountLabel: "@号a", status: PublishStatus.DOWNLOADED }], "号A"),
    { action: "update", id: "9" },
  );
  assert.equal(accountLabelKey(" ＠Ａivora　号 "), "aivora 号");
});

test("[publish] 迁移只加一个可空列，不带任何破坏性语句", () => {
  const sql = readFileSync(
    "prisma/migrations/20261109120000_publish_record_account_label/migration.sql",
    "utf8",
  );
  const statements = sql
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("--"))
    .join(" ");
  assert.equal(
    statements,
    `SET lock_timeout = '5s'; ALTER TABLE "PublishRecord" ADD COLUMN IF NOT EXISTS "accountLabel" TEXT;`,
  );
  assert.match(readFileSync("prisma/schema.prisma", "utf8"), /accountLabel\s+String\?/);
});
