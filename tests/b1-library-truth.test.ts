import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LIBRARY_ROWS_PER_SOURCE,
  batchJobStatusToLibraryStatus,
  filterCustomerLibraryRows,
  refineOrderLibraryStatus,
  toBatchLibraryRow,
  toContentPostLibraryRow,
  toUnifiedLibraryRow,
} from "../src/lib/services/unified-library-service";
import { BGM_ATTRIBUTIONS } from "../src/lib/video-generation/bgm-attribution";

/**
 * 1025 · B1.4–B1.6：成品库的状态、需要处理、截断与坏行。
 */

type BatchJobInput = Parameters<typeof toBatchLibraryRow>[0];
type OrderInput = Parameters<typeof toUnifiedLibraryRow>[0];

function batchJob(overrides: Record<string, unknown> = {}): BatchJobInput {
  return {
    id: "job-1",
    batchIndex: 11,
    status: "RUNNING",
    lastProgress: 42,
    outputVideoUrl: null,
    outputThumbUrl: null,
    brandedVideoUrl: null,
    templateSnapshot: null,
    updatedAt: new Date("2026-10-24T10:00:00.000Z"),
    batchJob: { id: "batch-1", productName: "遮阳帘", template: { nameZh: "开箱", name: "Unboxing" } },
    ...overrides,
  } as unknown as BatchJobInput;
}

function order(brief: Record<string, unknown>): OrderInput {
  return {
    id: "order-1",
    title: "单条订单",
    createdAt: new Date("2026-10-24T09:00:00.000Z"),
    updatedAt: new Date("2026-10-24T10:00:00.000Z"),
    rounds: [{ angles: [{ videoBrief: {
      id: "brief-1",
      status: "RENDERING",
      durationSec: 15,
      aspectRatio: "9:16",
      finalVideoUrl: null,
      finalThumbnailUrl: null,
      brandedVideoUrl: null,
      takedownAt: null,
      createdAt: new Date("2026-10-24T09:00:00.000Z"),
      storyboardRun: null,
      finalVideo: null,
      videoJobs: [],
      ...brief,
    } }] }],
  } as unknown as OrderInput;
}

test("契约：暂停是 paused、取消是 cancelled（不再归「生成中」「失败」）", () => {
  assert.equal(batchJobStatusToLibraryStatus("PAUSED"), "paused");
  assert.equal(batchJobStatusToLibraryStatus("CANCELLED"), "cancelled");
  assert.equal(batchJobStatusToLibraryStatus("QUEUED"), "planning");
  assert.equal(batchJobStatusToLibraryStatus("RUNNING"), "generating");
  const paused = toBatchLibraryRow(batchJob({ status: "PAUSED", lastProgress: 0 }))!;
  assert.equal(paused.status, "paused");
  assert.equal(paused.progress, 0);
  // 序号在前：窄屏截断吃掉的是模板名，不是「#12」
  assert.equal(paused.title, "遮阳帘 #12 · 开箱");
  assert.equal(toBatchLibraryRow(batchJob({ status: "CANCELLED" }))!.status, "cancelled");
});

test("单条订单：只有分段真在跑才叫生成中；排队、暂停、失败、取消各归各位", () => {
  assert.equal(refineOrderLibraryStatus("generating", ["RUNNING", "QUEUED"]), "generating");
  assert.equal(refineOrderLibraryStatus("generating", ["QUEUED"]), "planning");
  assert.equal(refineOrderLibraryStatus("generating", ["PAUSED"]), "paused");
  assert.equal(refineOrderLibraryStatus("generating", ["SUCCEEDED", "FAILED"]), "failed");
  assert.equal(refineOrderLibraryStatus("generating", ["CANCELLED", "CANCELLED"]), "cancelled");
  assert.equal(refineOrderLibraryStatus("generating", ["SUCCEEDED", "SUCCEEDED"]), "assembling");
  assert.equal(refineOrderLibraryStatus("generating", []), "planning");
  assert.equal(refineOrderLibraryStatus("ready", ["FAILED"]), "ready");
  const queued = toUnifiedLibraryRow(order({ videoJobs: [{ status: "QUEUED", lastProgress: null, submittedAt: null, finishedAt: null, createdAt: null }] }))!;
  assert.equal(queued.status, "planning");
  assert.equal(queued.progress, 0, "排队不显示进度");
});

test("取消且没有媒体的不进列表；失败行交给「需要处理」区（与徽标同一个查询）", () => {
  const cancelled = toBatchLibraryRow(batchJob({ status: "CANCELLED" }))!;
  const failed = toBatchLibraryRow(batchJob({ id: "job-2", status: "FAILED" }))!;
  const running = toBatchLibraryRow(batchJob({ id: "job-3" }))!;
  assert.deepEqual(filterCustomerLibraryRows([cancelled, failed, running]).map((row) => row.id), ["batch-job-3"]);
});

test("坏行不拖垮整页：safeParse 丢掉这一行并上报", (t) => {
  const errors: unknown[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  const bad = toContentPostLibraryRow({
    id: "p1",
    key: "k1",
    format: "SINGLE_IMAGE",
    status: "READY",
    copyHook: "钩子",
    renderedImageUrls: ["not-a-url"],
    updatedAt: new Date("2026-10-24"),
    plan: { id: "plan-1", theme: "主题" },
  } as never);
  assert.equal(bad, null);
  assert.equal(errors.length, 1);
  assert.match(JSON.stringify(errors[0]), /dropped invalid row/);
});

test("短视频帖是「待生产」，不是成片", () => {
  const row = toContentPostLibraryRow({
    id: "p2",
    key: "k2",
    format: "VIDEO",
    status: "DRAFT",
    copyHook: "三秒看懂",
    renderedImageUrls: [],
    updatedAt: new Date("2026-10-24"),
    plan: { id: "plan-1", theme: "主题" },
  } as never)!;
  assert.equal(row.status, "planning");
  assert.equal(row.postFormat, "VIDEO");
});

test("配乐署名随交付：批量读批次后期快照，单条读 FinalVideo.postProduction", () => {
  const postProduction = { audio: { bgm: { trackId: "wholesome", volume: 0.3 } } };
  const batchRow = toBatchLibraryRow(batchJob({
    status: "SUCCEEDED",
    outputVideoUrl: "https://cdn.example.com/a.mp4",
    templateSnapshot: { __batchPostProduction: postProduction },
  }))!;
  assert.equal(batchRow.bgmAttribution, BGM_ATTRIBUTIONS.wholesome);
  const silent = toBatchLibraryRow(batchJob({ templateSnapshot: { __batchPostProduction: { audio: { bgm: { trackId: "wholesome", volume: 0 } } } } }))!;
  assert.equal(silent.bgmAttribution, null, "音量 0 等于没混进成片");
  const orderRow = toUnifiedLibraryRow(order({
    status: "QA_PENDING",
    finalVideo: { status: "READY", stitchedVideoUrl: "https://cdn.example.com/b.mp4", thumbnailUrl: null, subtitleFileUrl: null, segmentCount: 1, startedAt: null, finishedAt: null, postProduction },
    videoJobs: [{ status: "SUCCEEDED", lastProgress: 100, submittedAt: null, finishedAt: null, createdAt: null }],
  }))!;
  assert.equal(orderRow.status, "ready");
  assert.equal(orderRow.bgmAttribution, BGM_ATTRIBUTIONS.wholesome);
});

test("成品库每来源 300 条，超出时页面写明截断", () => {
  assert.equal(LIBRARY_ROWS_PER_SOURCE, 300);
  const service = readFileSync("src/lib/services/unified-library-service.ts", "utf8");
  assert.match(service, /const take = LIBRARY_ROWS_PER_SOURCE \+ 1;/);
  assert.doesNotMatch(service, /take:\s*100\b/);
  const page = readFileSync("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(page, /library\.truncated \?/);
  assert.match(page, /copy\.truncated\.replace\("\{n\}", String\(library\.perSourceLimit\)\)/);
});

test("成品库页面：生产线上只放真在生成的行；排队与暂停不挂光束、不写百分比", () => {
  const page = readFileSync("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(page, /const makingRows = rows\.filter\(\(row\) => !isPost\(row\) && \(row\.status === "generating" \|\| row\.status === "assembling"\)\)/);
  assert.match(page, /const waitingRows = rows\.filter\(\(row\) => !isPost\(row\) && \(row\.status === "planning" \|\| row\.status === "paused"\)\)/);
  const waiting = page.slice(page.indexOf("{waitingRows.length > 0"), page.indexOf("{actionRows.length > 0"));
  assert.doesNotMatch(waiting, /data-beam|x-live|row\.progress|<Progress/);
  assert.match(waiting, /<StatusTick entity="item" state=\{libraryRowState\(row\.status\)\}/);
  const making = page.slice(page.indexOf("{makingRows.length > 0"), page.indexOf("{waitingRows.length > 0"));
  assert.match(making, /data-beam="row"/);
});

test("需要处理：列出失败（原因 + 重试 / 联系支持，批量链批次详情），「看过了」清零，与徽标同一个查询", () => {
  const page = readFileSync("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(page, /loadNeedsAttention\(userId, \{ locale \}\)/);
  assert.match(page, /count=\{attention\.total\}/);
  assert.match(page, /<FailuresAckButton/);
  assert.match(page, /failureReason\(item, english/);
  assert.match(page, /copy\.retryInBatch/);
  assert.match(page, /copy\.contactSupport/);
  const button = readFileSync("src/components/library/failures-ack-button.tsx", "utf8");
  assert.match(button, /fetch\("\/api\/exchange\/failures-ack", \{ method: "POST" \}\)/);
  assert.match(button, /requestPulseRefresh\(\);\s*router\.refresh\(\);/);

  const readings = readFileSync("src/lib/services/exchange-readings.ts", "utf8");
  const pulseCount = readings.slice(readings.indexOf("async function countNeedsAttention"), readings.indexOf("export type ProductionCounts"));
  const listing = readings.slice(readings.indexOf("export async function loadNeedsAttention"), readings.indexOf("export async function acknowledgeFailures"));
  for (const block of [pulseCount, listing]) {
    assert.match(block, /batchFailureWhere\(userId, /);
    assert.match(block, /orderFailureWhere\(userId, /);
  }
  assert.match(listing, /href: `\/app\/batches\/\$\{job\.batchJob\.id\}`/);
  assert.match(listing, /retryHref: `\/app\/create\?retry=\$\{encodeURIComponent\(order\.id\)\}`/);
});

test("?highlight=<id>：派发返回的那一行被描边并滚到视野里", () => {
  const page = readFileSync("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(page, /searchParams: Promise<\{ q\?: string; highlight\?: string \}>/);
  assert.match(page, /\{highlight \? <LibraryHighlight rowId=\{highlight\} \/> : null\}/);
  assert.match(page, /data-highlighted=\{isHighlighted\(row\.id\)\}/);
  const scroller = readFileSync("src/components/library/library-highlight.tsx", "utf8");
  assert.match(scroller, /\[data-library-row="\$\{CSS\.escape\(rowId\)\}"\]/);
  assert.match(scroller, /scrollIntoView/);
  const globals = readFileSync("src/app/globals.css", "utf8");
  assert.match(globals, /\[data-highlighted="true"\]\s*\{\s*outline: 2px solid var\(--accent\)/);
});
