import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import { SHOWCASE_SAMPLES, type ShowcaseSample } from "../src/lib/config/showcase-allowlist";
import {
  __test__ as showcaseInternals,
  isShowcaseBatchAllowed,
  resolveShowcaseFor,
  resolveShowcaseSourceFor,
  showcaseAllowlist,
} from "../src/lib/services/showcase-library";
import {
  getUnifiedLibraryItem,
  loadUnifiedLibrary,
  showcaseOrderWhere,
} from "../src/lib/services/unified-library-service";

/**
 * 2026-10-25 审计 A10：样片账号名下全部已完成内容默认注入每个账号的成品库（混着非 SunnyShutter 测试片）。
 * 改成白名单：默认空 ⇒ 什么都不注入；只认样片账号自己名下、已成片的点名条目；标「样片」只读、不计读数；
 * LIBRARY_SHOWCASE=off 仍然关闭。
 */

function patch(t: TestContext, target: Record<string, unknown>, key: string, fn: unknown) {
  const original = target[key];
  target[key] = fn;
  t.after(() => {
    target[key] = original;
  });
}

function withShowcaseEnv(t: TestContext, value: string | undefined) {
  const previous = process.env.LIBRARY_SHOWCASE;
  if (value === undefined) delete process.env.LIBRARY_SHOWCASE;
  else process.env.LIBRARY_SHOWCASE = value;
  showcaseInternals.resetShowcaseUserIdCache();
  t.after(() => {
    if (previous === undefined) delete process.env.LIBRARY_SHOWCASE;
    else process.env.LIBRARY_SHOWCASE = previous;
    showcaseInternals.resetShowcaseUserIdCache();
  });
}

function stubShowcaseOwner(t: TestContext, ownerId: string | null) {
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  const calls: unknown[] = [];
  patch(t, anyDb.adminUser, "findUnique", async (args: unknown) => {
    calls.push(args);
    return ownerId ? { id: ownerId } : null;
  });
  return calls;
}

const SAMPLES: ShowcaseSample[] = [
  { kind: "final_video", id: " fv-1 " },
  { kind: "final_video", id: "fv-1" },
  { kind: "order", id: "order-legacy" },
  { kind: "batch_video", id: "job-7" },
  { kind: "content_post", id: "post-3" },
  { kind: "content_post", id: "   " },
];

test("出厂白名单是一份合法的列表（默认空，由创始人会话按生产数据填）", () => {
  assert.ok(Array.isArray(SHOWCASE_SAMPLES));
  for (const sample of SHOWCASE_SAMPLES) {
    assert.ok(["final_video", "order", "batch_video", "content_post"].includes(sample.kind), sample.kind);
    assert.ok(sample.id.trim().length > 0, "id 不能为空");
  }
});

test("白名单为空：什么都不注入，连样片账号都不查", async (t) => {
  withShowcaseEnv(t, undefined);
  const lookups = stubShowcaseOwner(t, "showcase-owner");
  assert.equal(await resolveShowcaseFor("viewer-1", []), null);
  assert.equal(lookups.length, 0);
});

test("LIBRARY_SHOWCASE=off 仍然一键关闭，即使白名单有内容", async (t) => {
  withShowcaseEnv(t, "off");
  const lookups = stubShowcaseOwner(t, "showcase-owner");
  assert.equal(await resolveShowcaseFor("viewer-1", SAMPLES), null);
  assert.equal(lookups.length, 0);
});

test("白名单有内容：按来源拆开、去空白去重；样片账号本人不看自己的样片", async (t) => {
  withShowcaseEnv(t, undefined);
  stubShowcaseOwner(t, "showcase-owner");
  assert.deepEqual(await resolveShowcaseFor("viewer-1", SAMPLES), {
    ownerId: "showcase-owner",
    allow: {
      finalVideoIds: ["fv-1"],
      orderIds: ["order-legacy"],
      batchVideoJobIds: ["job-7"],
      contentPostIds: ["post-3"],
    },
  });
  assert.equal(await resolveShowcaseFor("showcase-owner", SAMPLES), null);
});

test("旧入口 resolveShowcaseSourceFor 也走白名单：出厂（空白名单）时不露出样片账号", async (t) => {
  withShowcaseEnv(t, undefined);
  stubShowcaseOwner(t, "showcase-owner");
  if (SHOWCASE_SAMPLES.length === 0) {
    assert.equal(await resolveShowcaseSourceFor("viewer-1"), null);
  }
});

test("只查样片账号名下被点名的单条：订单 id 或成片 FinalVideo id", () => {
  const allow = showcaseAllowlist(SAMPLES);
  assert.deepEqual(showcaseOrderWhere("showcase-owner", allow), {
    createdById: "showcase-owner",
    productCategory: "unified_input",
    OR: [
      { id: { in: ["order-legacy"] } },
      { rounds: { some: { angles: { some: { videoBrief: { is: { finalVideoId: { in: ["fv-1"] } } } } } } } },
    ],
  });
  assert.equal(showcaseOrderWhere("showcase-owner", showcaseAllowlist([{ kind: "batch_video", id: "job-7" }])), null);
  assert.equal(isShowcaseBatchAllowed([{ id: "job-1" }, { id: "job-7" }], allow), true);
  assert.equal(isShowcaseBatchAllowed([{ id: "job-1" }], allow), false);
});

function stubLibrarySources(t: TestContext, rows: { orders?: unknown[]; jobs?: unknown[]; posts?: unknown[] } = {}) {
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  const wheres = { orders: [] as unknown[], jobs: [] as unknown[], posts: [] as unknown[] };
  patch(t, anyDb.deliveryOrder, "findMany", async (args: { where: unknown }) => {
    wheres.orders.push(args.where);
    return (args.where as { createdById?: string }).createdById === "showcase-owner" ? rows.orders ?? [] : [];
  });
  patch(t, anyDb.videoJob, "findMany", async (args: { where: unknown }) => {
    wheres.jobs.push(args.where);
    return JSON.stringify(args.where).includes("showcase-owner") ? rows.jobs ?? [] : [];
  });
  patch(t, anyDb.contentPost, "findMany", async (args: { where: unknown }) => {
    wheres.posts.push(args.where);
    return JSON.stringify(args.where).includes("showcase-owner") ? rows.posts ?? [] : [];
  });
  return wheres;
}

test("成品库：白名单为空时只查访问者本人，不碰样片账号", async (t) => {
  withShowcaseEnv(t, undefined);
  const lookups = stubShowcaseOwner(t, "showcase-owner");
  const wheres = stubLibrarySources(t);
  const result = await loadUnifiedLibrary("viewer-1", { showcaseSamples: [] });
  assert.deepEqual(result.rows, []);
  assert.equal(lookups.length, 0);
  assert.equal(wheres.orders.length, 1);
  assert.doesNotMatch(JSON.stringify([wheres.orders, wheres.jobs, wheres.posts]), /showcase-owner/);
});

function batchJob(id: string, status: "SUCCEEDED" | "RUNNING") {
  return {
    id,
    batchIndex: 0,
    status,
    lastProgress: status === "SUCCEEDED" ? 100 : 40,
    outputVideoUrl: status === "SUCCEEDED" ? `https://cdn.example.test/${id}.mp4` : null,
    outputThumbUrl: null,
    brandedVideoUrl: null,
    templateSnapshot: null,
    updatedAt: new Date("2026-10-20T00:00:00.000Z"),
    batchJob: { id: "batch-1", productName: "Sunny Shutter", template: { nameZh: "整扇开合", name: "Shutter" } },
  };
}

test("成品库：白名单有内容时只查被点名的 id，注入的行标样片、只留已成片", async (t) => {
  withShowcaseEnv(t, undefined);
  stubShowcaseOwner(t, "showcase-owner");
  const wheres = stubLibrarySources(t, { jobs: [batchJob("job-7", "SUCCEEDED"), batchJob("job-8", "RUNNING")] });
  const result = await loadUnifiedLibrary("viewer-1", { showcaseSamples: SAMPLES });

  assert.deepEqual(wheres.jobs.at(-1), { id: { in: ["job-7"] }, batchJob: { userId: "showcase-owner" } });
  assert.deepEqual(wheres.posts.at(-1), { id: { in: ["post-3"] }, plan: { userId: "showcase-owner" } });
  assert.deepEqual(result.rows.map((row) => [row.id, row.isShowcase, row.status]), [["batch-job-7", true, "ready"]]);
});

test("详情页：白名单为空时样片账号的订单一律 404（不再按账号放行）", async (t) => {
  withShowcaseEnv(t, undefined);
  const lookups = stubShowcaseOwner(t, "showcase-owner");
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  const finds: unknown[] = [];
  patch(t, anyDb.deliveryOrder, "findFirst", async (args: { where: unknown }) => {
    finds.push(args.where);
    return null;
  });
  assert.equal(await getUnifiedLibraryItem("viewer-1", "order-of-showcase", []), null);
  assert.equal(finds.length, 1, "只查了访问者自己的订单");
  assert.equal(lookups.length, 0);
});

test("接线：批次详情只读展示也要命中白名单；样片标注写明不计入读数", async () => {
  const page = await readFile("src/app/(platform)/app/batches/[id]/page.tsx", "utf8");
  assert.match(page, /const showcase = await resolveShowcaseFor\(session\.user\.id\);/);
  assert.match(page, /if \(!isShowcaseBatchAllowed\(batch\.videoJobs, showcase\.allow\)\) notFound\(\);/);
  assert.match(getPlatformCopy("zh-CN").library.showcaseBadge, /^样片$/);
  assert.match(getPlatformCopy("zh-CN").library.showcaseHint, /不计入任何读数/);
  assert.match(getPlatformCopy("en-US").library.showcaseHint, /not counted in any reading/);
  /// 与状态栏「不含示例数据」同一口径：成品库读数口径写明不含样片
  assert.match(getPlatformCopy("zh-CN").library.scope, /不含样片/);
  assert.match(getPlatformCopy("zh-CN").shell.statusSource, /不含示例数据/);
});
