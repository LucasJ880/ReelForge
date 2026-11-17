import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { firstSpokenLine, groupLibraryRows, libraryGroupName } from "../src/lib/library/group-rows";

/**
 * 成品库按商品分栏（2026-11-17）：之前是一张平铺的大网格，同一件商品的几条片标题一模一样，
 * 一条测试描述重复了 16 张卡。现在每件商品一栏，栏里的片用开头那句台词区分。
 */
const row = (id: string, title: string, at: string, extra: Partial<{ source: "order" | "batch" | "post"; isShowcase: boolean }> = {}) => ({
  id, title, source: "order" as const, isShowcase: false, updatedAt: new Date(at), ...extra,
});

test("同一件商品的几条片归到一栏，栏按最近做过的在前，栏里按时间倒序", () => {
  const groups = groupLibraryRows([
    row("a", "婴儿纱布口水巾，三条一包，三角巾款式，白色、姜黄、棕色三个颜色。多层纯棉纱布，柔软吸水。", "2026-11-17T10:00:00Z"),
    row("b", "梦馨家纺源头工厂探厂解说：带大家从工厂大门走进去", "2026-11-17T12:00:00Z"),
    row("c", "婴儿纱布口水巾，三条一包，三角巾款式，白色、姜黄、棕色三个颜色。多层纯棉纱布，柔软吸水。", "2026-11-17T11:00:00Z"),
    row("d", "婴儿纱布口水巾，三条一包，三角巾款式，白色、姜黄、棕色三个颜色。多层纯棉纱布，柔软吸水。", "2026-11-16T09:00:00Z"),
  ]);
  assert.deepEqual(groups.map((group) => [group.name, group.rows.map((item) => item.id)]), [
    ["梦馨家纺源头工厂探厂解说", ["b"]],
    ["婴儿纱布口水巾", ["c", "a", "d"]],
  ]);
  assert.equal(groups[1]!.latest.toISOString(), "2026-11-17T11:00:00.000Z");
});

test("批量成片按商品名归栏（标题里的序号和模板名不算）；样片单独成栏并放最后", () => {
  const groups = groupLibraryRows([
    row("s", "样片 · 电动卷帘", "2026-11-17T13:00:00Z", { isShowcase: true }),
    row("b1", "斑马帘 #1 · 价值感证明", "2026-10-26T10:00:00Z", { source: "batch" }),
    row("b2", "斑马帘 #2 · 开箱上手", "2026-10-26T10:05:00Z", { source: "batch" }),
    row("o", "斑马帘", "2026-11-01T10:00:00Z"),
  ]);
  assert.equal(libraryGroupName({ title: "斑马帘 #12 · 价值感证明", source: "batch" }), "斑马帘");
  assert.deepEqual(groups.map((group) => [group.name, group.isShowcase, group.rows.length]), [
    ["斑马帘", false, 3],
    ["样片 · 电动卷帘", true, 1],
  ]);
});

test("开头那句台词：从后期快照的口播稿取第一句；没开口播、没有稿子、读不懂都是 null", () => {
  const post = (script: string, enabled = true) => ({ audio: { voiceover: { enabled, script } } });
  assert.equal(firstSpokenLine(post("辅食一漏，又换衣？ 多层棉纱，柔软吸水。")), "辅食一漏，又换衣？");
  assert.equal(firstSpokenLine(post("源头工厂，进门看。面料都在这里。")), "源头工厂，进门看");
  assert.equal(firstSpokenLine(post("Spills land on the bib, not the shirt. Soft cotton gauze.")), "Spills land on the…");
  assert.equal(firstSpokenLine(post("吃得真开心！", false)), null);
  assert.equal(firstSpokenLine(post("   ")), null);
  assert.equal(firstSpokenLine(null), null);
  assert.equal(firstSpokenLine({ audio: {} }), null);
});

test("成品库页面：按商品分栏渲染，最前面三栏默认展开，带着 highlight 进来的那一栏也展开；每栏最后一格是「再做一条」", () => {
  const page = readFileSync("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(page, /const productGroups = groupLibraryRows\(readyVideoRows\);/);
  assert.match(page, /const OPEN_GROUPS = 3;/);
  assert.match(page, /const open = groupIndex < OPEN_GROUPS \|\| group\.rows\.some\(\(row\) => row\.id === highlight\);/);
  assert.match(page, /data-testid="library-product-group"/);
  assert.match(page, /row\.hook \? `「\$\{row\.hook\}」`/);
  assert.match(page, /href=\{`\/app\/create\?retry=\$\{encodeURIComponent\(retryId\)\}`\}/);
  /// 不再是平铺的大网格
  assert.doesNotMatch(page, /grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4/);
  const service = readFileSync("src/lib/services/unified-library-service.ts", "utf8");
  assert.match(service, /hook: firstSpokenLine\(finalVideo\?\.postProduction \?\? null\),/);
});
