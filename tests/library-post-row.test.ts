import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { toContentPostLibraryRow } from "../src/lib/services/unified-library-service";

/**
 * 0802 用户录屏抓到的事故链：成品库图文帖行 → 「查看成片」→
 * /app/library/post-xxx → 404；且未出图的帖子显示「生成中 0%」误导商家。
 * 这组测试守住整条链不回潮。
 */

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    key: "k1",
    format: "SINGLE_IMAGE",
    status: "DRAFT",
    copyHook: "钩子",
    renderedImageUrls: [] as string[],
    updatedAt: new Date("2026-08-02"),
    plan: { id: "plan1", theme: "本周主题" },
    ...overrides,
  } as never;
}

test("🔴 未出图的图文帖是「准备中」，不是「生成中」—— 没有任务在跑", () => {
  const row = toContentPostLibraryRow(post())!;
  assert.equal(
    row.status,
    "planning",
    "显示「生成中 0%」会让商家以为卡死了，实情是等他点「生成配图」",
  );
  assert.equal(row.progress, 0);
});

test("出过图的图文帖是 ready；纯文案帖天生 ready", () => {
  assert.equal(
    toContentPostLibraryRow(post({ renderedImageUrls: ["https://cdn.example.com/a.png"], status: "READY" }))!.status,
    "ready",
  );
  assert.equal(toContentPostLibraryRow(post({ format: "TEXT" }))!.status, "ready");
});

test("🔴 列表页：post 行不链视频详情（那里必 404），也不链已删的本周内容；做好的图文卡直接打开配图", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(platform)/app/library/page.tsx"),
    "utf8",
  );
  /// 「本周内容」（/app/plan）2026-11-16 删了：图文帖没有详情页，成片图文卡点开就是它的配图
  assert.doesNotMatch(source, /\/app\/plan/);
  assert.match(source, /readyPostRows\.map/);
  assert.match(source, /<a href=\{row\.imageUrls\[0\]\} target="_blank" rel="noopener noreferrer"/);
  /// 没出完图的帖子不再列出来：能让它往下走的那一页没了，摆着只是一行点不动的字
  assert.match(source, /row\.source !== "post" \|\| row\.status === "ready"/);
  /// 视频分区绝不掺 post 行
  assert.match(source, /row\.status === "ready" && !isPost\(row\)/);
  /// 只给视频行算详情链接
  assert.match(source, /row\.source === "batch" \? `\/app\/batches\/\$\{row\.batchId\}` : `\/app\/library\/\$\{row\.id\}`/);
});

test("🔴 详情页：post- 前缀的老链接 redirect 回成品库，不 404", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(platform)/app/library/[id]/page.tsx"),
    "utf8",
  );
  assert.match(source, /id\.startsWith\("post-"\)\s*\)?\s*redirect\("\/app\/library"\)/);
});

test("全局 404 不再引用旧代运营入口（交付单列表 /orders）", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/not-found.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /交付单列表/);
  assert.doesNotMatch(source, /href="\/orders"/);
  assert.match(source, /href="\/"/, "回 / 由角色路由决定去处");
});

test("铁律 #7：产品图的取消语义为清幂等键、保留素材（接口随工作台 2026-11-16 删除，服务函数还在）", () => {
  const service = readFileSync(
    path.join(process.cwd(), "src/lib/services/product-image-service.ts"),
    "utf8",
  );
  const start = service.indexOf("export async function cancelProductImageJob");
  const end = service.indexOf("\nexport ", start + 1);
  const block = service.slice(start, end === -1 ? undefined : end);
  assert.ok(block.length > 100, "cancelProductImageJob 必须存在");
  /// 清幂等键：改写而不是复用，商家可立刻用同样输入重新发起。
  assert.match(block, /idempotencyKey: `cancelled:/);
  /// 保留素材：只把未终态 task 置 CANCELLED，绝不动 SUCCEEDED 的产出。
  assert.match(block, /in: \[ProductImageStatus\.QUEUED, ProductImageStatus\.PROCESSING\]/);
  assert.doesNotMatch(block, /delete|Delete/);
  /// owner 校验进查询条件。
  assert.match(block, /id: args\.jobId, userId: args\.userId/);
});
