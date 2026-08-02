import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  hardenImagePrompt,
  readSlides,
} from "../src/lib/services/content-post-render-service";

test("出图提示词强制禁止模型写字 —— 文字由我们叠", () => {
  const hardened = hardenImagePrompt("温馨客厅里的卷帘");
  assert.match(hardened, /no text/i);
  assert.match(hardened, /no letters/i);
  assert.match(hardened, /no watermarks/i);
  assert.ok(hardened.startsWith("温馨客厅里的卷帘"), "原提示词要保留在最前");
});

test("轮播分屏按 order 排序，脏数据丢弃而不是崩", () => {
  const slides = readSlides([
    { order: 2, imagePrompt: "第三屏" },
    { order: 0, imagePrompt: "第一屏", overlayText: "第 1 步" },
    { order: 1, imagePrompt: "   " },
    null,
    "字符串不是分屏",
    { order: 1, imagePrompt: "第二屏" },
  ]);
  assert.deepEqual(
    slides.map((s) => s.imagePrompt),
    ["第一屏", "第二屏", "第三屏"],
  );
  assert.equal(slides[0].overlayText, "第 1 步");
  assert.equal(slides[1].overlayText, null);
});

test("非数组 slidesJson 返回空数组", () => {
  assert.deepEqual(readSlides(null), []);
  assert.deepEqual(readSlides({}), []);
  assert.deepEqual(readSlides("[]"), []);
});

test("已出图的帖子幂等返回，不重复计费", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/content-post-render-service.ts"),
    "utf8",
  );
  assert.match(
    source,
    /renderedImageUrls\.length > 0[\s\S]{0,120}skipped: true/,
    "重复出图必须短路返回，否则商家点两次就扣两次",
  );
});

test("失败时保留已出的素材，不把花过钱的图丢掉", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/content-post-render-service.ts"),
    "utf8",
  );
  const catchBlock = source.slice(source.indexOf("} catch (err) {"));
  assert.match(
    catchBlock.slice(0, 400),
    /renderedImageUrls: urls/,
    "出图中途失败要把已成功的几张记下来",
  );
});

test("取消只清运行态、保留素材，且不物理删除记录", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/content-post-render-service.ts"),
    "utf8",
  );
  const discard = source.slice(source.indexOf("export async function discardContentPost"));
  assert.match(discard, /status: "DISCARDED"/);
  assert.doesNotMatch(
    discard,
    /renderedImageUrls: \[\]|\.delete\(|deleteMany/,
    "取消不能删素材、不能删记录",
  );
});

test("越权防护：owner 校验在查询条件里，不靠调用方比对", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/content-post-render-service.ts"),
    "utf8",
  );
  const matches = source.match(/plan: \{ userId: args\.userId \}/g) ?? [];
  assert.ok(
    matches.length >= 2,
    "读与写都要带 owner 条件",
  );
});

test("出图路由：供应商故障可重试，格式问题不可重试", () => {
  const route = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/content-plans/[id]/posts/[postId]/render/route.ts",
    ),
    "utf8",
  );
  assert.match(route, /retryable: err\.reason === "provider"/);
  /// 铁律：失败不能只给重试，必须有取消入口。
  assert.match(route, /export async function DELETE/);
});
