import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { PLATFORM_PRIMARY_NAV, platformPathAfterGeneration } from "../src/lib/platform-routes";

/// PRD v3.3 O1 起「本周内容」是新定位的主入口，排在最前：
/// 小商家的痛点是发不出去、发得不连续，不是单条不够好。
/// 这里仍然逐项断言而不是只数个数 —— 一级区的增减必须是有意的产品决定。
test("Phase1 unified journey：一级区只有一套 /app 路径", () => {
  assert.deepEqual(PLATFORM_PRIMARY_NAV.map(({ label, href }) => ({ label, href })), [
    /// 2026-10-28 瘦身（学 LibTV）：「询盘」A 级下线，路由保留可直达。
    /// 「本周内容」「战绩」「投放赛马」三页 2026-11-16 彻底删除（旧网址由 next.config 转走）。
    { label: "创作", href: "/app/create" },
    { label: "成品库", href: "/app/library" },
    /// 2026-11-10 商品档案（用户确认：放在资产组，成品库和品牌之间）
    { label: "商品", href: "/app/products" },
    { label: "品牌", href: "/app/brands" },
    /// 2026-10-28 客户使用指南（学 LibTV「学院」）
    { label: "使用指南", href: "/app/guide" },
  ]);
  for (const gone of ["/app/plan", "/app/wins", "/app/racing", "/app/create/images"]) {
    assert.ok(!PLATFORM_PRIMARY_NAV.map((item): string => item.href).includes(gone), `${gone} 已删除，不能回到导航`);
  }
  assert.equal(platformPathAfterGeneration("order 1"), "/app/library?highlight=order%201");
});

test("Phase1 unified journey：各一级区页面与批次/成品详情均存在", async () => {
  for (const file of [
    "src/app/(platform)/app/create/page.tsx",
    "src/app/(platform)/app/library/page.tsx",
    "src/app/(platform)/app/library/[id]/page.tsx",
    "src/app/(platform)/app/brands/page.tsx",
    "src/app/(platform)/app/leads/page.tsx",
  ]) await access(file);
});

test("Phase1 unified journey：创作使用 account-neutral platform 请求并回统一成品库", async () => {
  const page = await readFile("src/app/(platform)/app/create/page.tsx", "utf8");
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  const dispatch = await readFile("src/app/api/video-generation/dispatch/route.ts", "utf8");
  assert.match(page, /StreamlinedVideoStudio/);
  assert.match(studio, /userType:\s*"platform"/);
  assert.match(studio, /router\.push\(payload\.nextUrl \?\? "\/app\/library"\)/);
  assert.match(dispatch, /request\.userType === "platform"[\s\S]*?\/app\/library/);
});

test("Phase1 unified journey：成品库按 owner 隔离，不再按 BUSINESS/PERSONAL persona 过滤", async () => {
  const source = await readFile("src/lib/services/unified-library-service.ts", "utf8");
  assert.match(source, /createdById:\s*userId/);
  assert.doesNotMatch(source, /persona\s*===|persona:\s*"BUSINESS"|persona:\s*"PERSONAL"/);
});

test("Phase1 unified journey：统一导航不暴露 digital human 或旧 B/C 路径", async () => {
  const source = await readFile("src/components/platform/platform-shell.tsx", "utf8");
  assert.doesNotMatch(source, /digital-human|\/business|\/personal/);
});
