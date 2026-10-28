import test from "node:test";
import assert from "node:assert/strict";
import { libraryDisplayTitle } from "../src/lib/library/display-title";

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
