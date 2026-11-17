import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { libraryDisplayTitle, libraryHeadline } from "../src/lib/library/display-title";

test("成片详情标题取第一句，过长截断；短标题原样", () => {
  assert.equal(
    libraryDisplayTitle("我们是一家卖保温杯的小店。早上出门前，女生把刚泡好的热茶倒进保温杯。"),
    "我们是一家卖保温杯的小店",
  );
  assert.equal(libraryDisplayTitle("窗帘爆款广告（15秒）· 空间焕新对比"), "窗帘爆款广告（15秒）· 空间焕新对比");
  assert.equal(libraryDisplayTitle("Matte bottle. Keeps tea hot all day."), "Matte bottle.");
  const long = "一".repeat(50);
  assert.equal(libraryDisplayTitle(long), `${"一".repeat(36)}…`);
});

test("成片详情的大标题：第一句还长就只取第一小句（商品名 / 这条片讲什么），视频才不会被挤到第二屏", () => {
  assert.equal(
    libraryHeadline("婴儿纱布口水巾，三条一包，三角巾款式，白色、姜黄、棕色三个颜色。多层纯棉纱布，柔软吸水。"),
    "婴儿纱布口水巾",
  );
  assert.equal(libraryHeadline("梦馨家纺源头工厂探厂解说：带大家从工厂大门走进去，看面料区、生产车间、包装，再到成品仓。"), "梦馨家纺源头工厂探厂解说");
  /// 本来就短的不动；第一小句太短（不到 4 个字）不取，整句截断
  assert.equal(libraryHeadline("窗帘爆款广告"), "窗帘爆款广告");
  assert.equal(libraryHeadline("我们，是一家在杭州做了二十年遮光窗帘和百叶的小店，欢迎来看看"), "我们，是一家在杭州做了二十年遮光窗帘和百叶的…");
  assert.equal(libraryHeadline("Matte bottle that keeps tea hot all day, for commuters"), "Matte bottle that keep…");
  /// 详情页：读数只在有失败片段时出现，整段描述折叠在视频下面
  const page = readFileSync("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(page, /const displayTitle = libraryHeadline\(item\.title\);/);
  assert.match(page, /item\.failedSceneCount > 0\s+\? \[/);
  assert.match(page, /data-testid="library-detail-meta"/);
  assert.match(page, /data-testid="library-brief"/);
  assert.ok(page.indexOf('data-testid="library-player"') < page.indexOf('data-testid="library-brief"'), "视频在整段描述前面");
});
