import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  decodeVideosApiCursor,
  encodeVideosApiCursor,
  videosApiQuerySchema,
  videosApiResponseSchema,
  VIDEOS_API_CURSOR_START,
} from "../src/lib/contracts/videos-api";
import { db } from "../src/lib/db";
import { listSyncableVideos } from "../src/lib/services/videos-sync-service";

/**
 * round 1025 · A1b 2.7 青砚游标（D7）。
 *
 * 旧的 since / next_since 语义（倒序取最新 limit 条、next_since=本页最旧一条）
 * 一字不改：积压超过 limit 时旧的会漏、稳态下又重复回传——但青砚确认前不能动。
 * 新增可选 cursor：(完成时间, 条目 id) 复合键升序翻页 + has_more。
 *
 * 全部 monkey-patch Prisma，不触真实 DB。
 */

test("游标编解码：不透明 base64url，往返无损；坏值一律解不出", () => {
  const token = encodeVideosApiCursor({
    completedAt: "2026-10-25T01:02:03.004Z",
    id: "batch-abc",
  });
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeVideosApiCursor(token), {
    completedAt: "2026-10-25T01:02:03.004Z",
    id: "batch-abc",
  });
  assert.equal(decodeVideosApiCursor("not-a-cursor"), null);
  assert.equal(
    decodeVideosApiCursor(
      Buffer.from(JSON.stringify({ t: "nope", id: "batch-1" })).toString("base64url"),
    ),
    null,
  );
  assert.equal(
    decodeVideosApiCursor(
      Buffer.from(JSON.stringify({ t: "2026-10-25T00:00:00Z", id: "x-1" })).toString("base64url"),
    ),
    null,
    "id 必须带 brief- / batch- 来源前缀",
  );
});

test("查询契约：cursor 可选；start 或合法游标通过，乱填拒绝；不传时旧语义原样", () => {
  assert.equal(videosApiQuerySchema.parse({}).cursor, undefined);
  assert.equal(
    videosApiQuerySchema.parse({ cursor: VIDEOS_API_CURSOR_START }).cursor,
    "start",
  );
  const token = encodeVideosApiCursor({
    completedAt: "2026-10-25T00:00:00.000Z",
    id: "brief-1",
  });
  assert.equal(videosApiQuerySchema.parse({ cursor: token }).cursor, token);
  assert.equal(videosApiQuerySchema.safeParse({ cursor: "garbage" }).success, false);
  assert.ok(
    videosApiQuerySchema.parse({ since: "2026-10-01T00:00:00.000Z" }).since instanceof Date,
  );
});

test("响应契约：旧响应（无 next_cursor / has_more）照常合法；游标字段可选", () => {
  assert.doesNotThrow(() =>
    videosApiResponseSchema.parse({
      videos: [],
      meta: { count: 0, skipped_unbranded: 0, next_since: null },
    }),
  );
  const parsed = videosApiResponseSchema.parse({
    videos: [],
    meta: {
      count: 0,
      skipped_unbranded: 0,
      next_since: null,
      next_cursor: "start",
      has_more: false,
    },
  });
  assert.equal(parsed.meta.has_more, false);
});

type FakeBriefRow = { id: string; brandedAt: Date; title: string | null };
type FakeJobRow = { id: string; brandedAt: Date };

/// 只解释游标模式用到的条件：brandedAt 的 gt/gte/等值、id 的 gt、OR、AND；
/// 共用的成片过滤（owner / 已封装 / 未下架）在假库里视为全部满足。
function matchesCursorWhere(
  row: { id: string; brandedAt: Date },
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "AND") {
      return (cond as Array<Record<string, unknown>>).every((c) => matchesCursorWhere(row, c));
    }
    if (key === "OR") {
      return (cond as Array<Record<string, unknown>>).some((c) => matchesCursorWhere(row, c));
    }
    if (key === "brandedAt") {
      if (cond instanceof Date) return row.brandedAt.getTime() === cond.getTime();
      const { gt, gte } = cond as { gt?: Date; gte?: Date };
      if (gt && !(row.brandedAt > gt)) return false;
      if (gte && !(row.brandedAt >= gte)) return false;
      return true;
    }
    if (key === "id") return row.id > (cond as { gt: string }).gt;
    return true;
  });
}

function fakeFindMany<R extends { id: string; brandedAt: Date }>(
  rows: R[],
  map: (row: R) => Record<string, unknown>,
) {
  return async (args: { where: Record<string, unknown>; orderBy: unknown; take: number }) => {
    const ascending = JSON.stringify(args.orderBy).includes('"asc"');
    return rows
      .filter((row) => matchesCursorWhere(row, args.where))
      .sort((a, b) =>
        ascending
          ? a.brandedAt.getTime() - b.brandedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
          : b.brandedAt.getTime() - a.brandedAt.getTime(),
      )
      .slice(0, args.take)
      .map(map);
  };
}

function installFakeFeed(t: TestContext, briefs: FakeBriefRow[], jobs: FakeJobRow[]) {
  const previous = {
    owners: process.env.QINGYAN_SYNC_OWNER_USER_IDS,
    showcase: process.env.LIBRARY_SHOWCASE,
  };
  process.env.QINGYAN_SYNC_OWNER_USER_IDS = "owner-1";
  process.env.LIBRARY_SHOWCASE = "off";
  const brief = db.videoBrief as unknown as Record<string, unknown>;
  const videoJob = db.videoJob as unknown as Record<string, unknown>;
  const originals = {
    briefFindMany: brief.findMany,
    briefCount: brief.count,
    jobFindMany: videoJob.findMany,
    jobCount: videoJob.count,
  };
  brief.findMany = fakeFindMany(briefs, (row) => ({
    id: row.id,
    durationSec: 15,
    aspectRatio: "9:16",
    brandedVideoUrl: `https://cdn.example.test/${row.id}.mp4`,
    finalVideoUrl: null,
    finalThumbnailUrl: null,
    brandedAt: row.brandedAt,
    takedownAt: null,
    updatedAt: row.brandedAt,
    contentAngle:
      row.title === null
        ? null
        : {
            title: row.title,
            round: { deliveryOrder: { title: row.title, createdById: "owner-1" } },
          },
    videoJobs: [],
  }));
  brief.count = async () => 2;
  videoJob.findMany = fakeFindMany(jobs, (row) => ({
    id: row.id,
    batchIndex: 0,
    brandedVideoUrl: `https://cdn.example.test/${row.id}.mp4`,
    outputThumbUrl: null,
    finishedAt: row.brandedAt,
    brandedAt: row.brandedAt,
    recipeId: null,
    hookType: null,
    templateId: null,
    aspectRatio: null,
    brandPlacement: null,
    templateSnapshot: null,
    batchJob: {
      productName: "百叶窗",
      userId: "owner-1",
      template: { nameZh: "整扇开合", name: "Shutter" },
    },
  }));
  videoJob.count = async () => 1;
  t.after(() => {
    brief.findMany = originals.briefFindMany;
    brief.count = originals.briefCount;
    videoJob.findMany = originals.jobFindMany;
    videoJob.count = originals.jobCount;
    if (previous.owners === undefined) delete process.env.QINGYAN_SYNC_OWNER_USER_IDS;
    else process.env.QINGYAN_SYNC_OWNER_USER_IDS = previous.owners;
    if (previous.showcase === undefined) delete process.env.LIBRARY_SHOWCASE;
    else process.env.LIBRARY_SHOWCASE = previous.showcase;
  });
}

const T = (iso: string) => new Date(iso);

const FEED_BRIEFS: FakeBriefRow[] = [
  { id: "b1", brandedAt: T("2026-10-25T01:00:00.000Z"), title: "Brief one" },
  { id: "b2", brandedAt: T("2026-10-25T02:00:00.000Z"), title: "Brief two" },
  { id: "b3", brandedAt: T("2026-10-25T02:00:00.000Z"), title: "Brief three" },
  /// 缺标题的行会被 briefToItem 过滤：游标必须越过它，不能卡在这里
  { id: "b4", brandedAt: T("2026-10-25T03:00:00.000Z"), title: null },
  { id: "b5", brandedAt: T("2026-10-25T04:00:00.000Z"), title: "Brief five" },
];
const FEED_JOBS: FakeJobRow[] = [
  /// 与 b1 同一毫秒、与 b2/b3 同一毫秒：同毫秒内 batch 排在 brief 前
  { id: "j1", brandedAt: T("2026-10-25T01:00:00.000Z") },
  { id: "j2", brandedAt: T("2026-10-25T02:00:00.000Z") },
  { id: "j3", brandedAt: T("2026-10-25T03:00:00.000Z") },
];
const EXPECTED_ORDER = [
  "batch-j1",
  "brief-b1",
  "batch-j2",
  "brief-b2",
  "brief-b3",
  "batch-j3",
  "brief-b5",
];

test("游标模式：小页翻到底，升序、不漏不重、同毫秒按 id 定序、坏行只被跳过一次", async (t) => {
  installFakeFeed(t, FEED_BRIEFS, FEED_JOBS);
  const seen: string[] = [];
  let cursor: string = VIDEOS_API_CURSOR_START;
  for (let pages = 1; ; pages += 1) {
    assert.ok(pages < 10, "翻页必须收敛");
    const page = await listSyncableVideos(
      videosApiQuerySchema.parse({ limit: "2", cursor }),
    );
    seen.push(...page.videos.map((video) => video.id));
    assert.equal(typeof page.meta.has_more, "boolean");
    assert.ok(page.meta.next_cursor);
    cursor = page.meta.next_cursor;
    if (!page.meta.has_more) break;
  }
  assert.deepEqual(seen, EXPECTED_ORDER);

  /// 到底之后继续用最后一个游标轮询：没有新成片就是空页、has_more=false、游标原样
  const idle = await listSyncableVideos(videosApiQuerySchema.parse({ limit: "2", cursor }));
  assert.deepEqual(idle.videos, []);
  assert.equal(idle.meta.has_more, false);
  assert.equal(idle.meta.next_cursor, cursor);
});

test("游标模式：一页取全时 has_more=false；next_since 是本页最新一条", async (t) => {
  installFakeFeed(t, FEED_BRIEFS, FEED_JOBS);
  const page = await listSyncableVideos(
    videosApiQuerySchema.parse({ limit: "50", cursor: VIDEOS_API_CURSOR_START }),
  );
  assert.deepEqual(page.videos.map((video) => video.id), EXPECTED_ORDER);
  assert.equal(page.meta.has_more, false);
  assert.equal(page.meta.count, EXPECTED_ORDER.length);
  assert.equal(page.meta.next_since, "2026-10-25T04:00:00.000Z");
  assert.equal(page.meta.skipped_unbranded, 3);
});

test("游标模式：start 可与 since 组合，从青砚已存的 next_since 无缝切换", async (t) => {
  installFakeFeed(t, FEED_BRIEFS, FEED_JOBS);
  const page = await listSyncableVideos(
    videosApiQuerySchema.parse({
      limit: "50",
      cursor: VIDEOS_API_CURSOR_START,
      since: "2026-10-25T02:00:00.000Z",
    }),
  );
  assert.deepEqual(page.videos.map((video) => video.id), ["batch-j3", "brief-b5"]);
});

test("不传 cursor：旧语义一字不改（倒序、最新 limit 条、meta 没有新字段）", async (t) => {
  installFakeFeed(t, FEED_BRIEFS, FEED_JOBS);
  const page = await listSyncableVideos(videosApiQuerySchema.parse({ limit: "3" }));
  assert.deepEqual(Object.keys(page.meta).sort(), ["count", "next_since", "skipped_unbranded"]);
  assert.deepEqual(
    page.videos.map((video) => video.completed_at),
    ["2026-10-25T04:00:00.000Z", "2026-10-25T03:00:00.000Z", "2026-10-25T02:00:00.000Z"],
  );
  assert.equal(page.meta.next_since, "2026-10-25T02:00:00.000Z");
});

test("名单为空的游标请求：不查库，空页 + 原样回传游标 + has_more=false", async () => {
  const previous = process.env.QINGYAN_SYNC_OWNER_USER_IDS;
  delete process.env.QINGYAN_SYNC_OWNER_USER_IDS;
  try {
    const page = await listSyncableVideos(
      videosApiQuerySchema.parse({ cursor: VIDEOS_API_CURSOR_START }),
    );
    assert.deepEqual(page, {
      videos: [],
      meta: {
        count: 0,
        skipped_unbranded: 0,
        next_since: null,
        next_cursor: "start",
        has_more: false,
      },
    });
  } finally {
    if (previous !== undefined) process.env.QINGYAN_SYNC_OWNER_USER_IDS = previous;
  }
});
