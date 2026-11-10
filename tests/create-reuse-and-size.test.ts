import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import { listRecentCreateSources, loadRecentCreateSourcesOrNone } from "../src/lib/services/create-retry-prefill-service";
import { applyProductSize, detectProductSize, PRODUCT_SIZE_MAX, stripProductSize } from "../src/lib/create/product-size";
import { applyHookAngle, detectHookAngle, stripHookAngle } from "../src/lib/create/hook-angles";

/**
 * 2026-11-10 创作页三件事：
 *   - 接着拍这些商品：回来的商家不用每次重新传图、重新写描述（不建新表，一件商品 = 以前某一单用过的那组图）；
 *   - 商品尺寸：描述后面补一行实际大小，商品在画面里不忽大忽小；
 *   - 出故事板的三段等待写明现在在哪一段。
 * 数据库全部 monkey-patch，零计费。
 */
function patch(t: TestContext, model: Record<string, unknown>, patches: Record<string, unknown>) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

const order = (id: string, prompt: string, assetIds: string[], owner = "owner-1") => ({
  id,
  productInput: { rawPrompt: prompt },
  rounds: [{ angles: [{ videoBrief: { storyboardRun: { userId: owner, sourcePrompt: prompt, inputAssetIds: assetIds } } }] }],
});

test("最近拍过的商品：只按属主读，同一组图只留最近一次，图不归本人的那一单不出现", async (t) => {
  const orderWhere: Array<Record<string, unknown>> = [];
  const assetWhere: Array<Record<string, unknown>> = [];
  patch(t, db.deliveryOrder as unknown as Record<string, unknown>, {
    findMany: async (args: { where: Record<string, unknown>; orderBy: unknown; take: number }) => {
      orderWhere.push(args.where);
      assert.deepEqual(args.orderBy, { createdAt: "desc" });
      return [
        order("o-5", "保温杯 通勤", ["cup-1", "cup-2"]),
        order("o-4", "保温杯 换个开头", ["cup-1", "cup-2"]),
        order("o-3", "唇釉 三个颜色", ["lip-1"]),
        order("o-2", "别人的故事板", ["x-1"], "someone-else"),
        order("o-1", "图已经删了的商品", ["gone-1"]),
        { id: "o-0", productInput: { rawPrompt: "没有故事板的老订单" }, rounds: [] },
      ];
    },
  });
  patch(t, db.mediaAsset as unknown as Record<string, unknown>, {
    findMany: async (args: { where: Record<string, unknown> }) => {
      assetWhere.push(args.where);
      return [
        { id: "cup-1", url: "/media/cup-1.jpg", mimeType: "image/jpeg" },
        { id: "lip-1", url: "/media/lip-1.png", mimeType: "image/png" },
      ];
    },
  });
  const sources = await listRecentCreateSources("owner-1");
  assert.equal(orderWhere[0].createdById, "owner-1");
  assert.equal(orderWhere[0].productCategory, "unified_input");
  assert.equal(assetWhere[0].userId, "owner-1", "图片也只认本人的");
  assert.deepEqual(sources.map((source) => source.orderId), ["o-5", "o-3"]);
  assert.deepEqual(sources[0], { orderId: "o-5", prompt: "保温杯 通勤", thumbnailUrl: "/media/cup-1.jpg", firstAssetId: "cup-1", imageCount: 2 });
});

test("最近拍过的商品：一单都没有 → 空列表，不去查图片；数量封顶", async (t) => {
  let assetQueries = 0;
  patch(t, db.deliveryOrder as unknown as Record<string, unknown>, { findMany: async () => [] });
  patch(t, db.mediaAsset as unknown as Record<string, unknown>, {
    findMany: async () => {
      assetQueries++;
      return [];
    },
  });
  assert.deepEqual(await listRecentCreateSources("owner-1"), []);
  assert.equal(assetQueries, 0);

  patch(t, db.deliveryOrder as unknown as Record<string, unknown>, {
    findMany: async () => Array.from({ length: 10 }, (_, index) => order(`o-${index}`, `商品 ${index}`, [`a-${index}`])),
  });
  patch(t, db.mediaAsset as unknown as Record<string, unknown>, {
    findMany: async (args: { where: { id: { in: string[] } } }) =>
      args.where.id.in.map((id) => ({ id, url: `/media/${id}.jpg`, mimeType: "image/jpeg" })),
  });
  assert.equal((await listRecentCreateSources("owner-1", 4)).length, 4);
});

test("最近拍过的商品：查询出错时创作页照常能用——当作没有，并留一行日志", async (t) => {
  patch(t, db.deliveryOrder as unknown as Record<string, unknown>, {
    findMany: async () => {
      throw new Error("connection reset");
    },
  });
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  t.after(() => {
    console.warn = original;
  });
  await assert.rejects(listRecentCreateSources("owner-1"), /connection reset/, "底层函数照常抛");
  assert.deepEqual(await loadRecentCreateSourcesOrNone("owner-1"), []);
  assert.ok(warnings.some((line) => line.includes("[create] recent sources unavailable") && line.includes("connection reset")));
});

test("商品尺寸：补一行、换一行、清空就去掉；描述为空不加", () => {
  const base = "这只保温杯通勤用，早上倒的水到办公室还是热的。";
  const sized = applyProductSize(base, "直径约 8 厘米，一只手能握住", "zh");
  assert.equal(sized, `${base}\n商品实际大小：直径约 8 厘米，一只手能握住`);
  assert.equal(detectProductSize(sized), "直径约 8 厘米，一只手能握住");
  assert.equal(detectProductSize(base), null);
  /// 换一个：只剩新的那一行
  const changed = applyProductSize(sized, "高 20 厘米", "zh");
  assert.equal(changed, `${base}\n商品实际大小：高 20 厘米`);
  /// 清空 / 只有空白：去掉这一行
  assert.equal(applyProductSize(sized, "", "zh"), base);
  assert.equal(applyProductSize(sized, "   ", "zh"), base);
  assert.equal(stripProductSize(sized), base);
  /// 描述为空：先让商家写要拍什么
  assert.equal(applyProductSize("", "直径 8 厘米", "zh"), "");
  /// 打字途中的空格不能被吃掉（输入框直接绑在描述上）
  assert.equal(detectProductSize(applyProductSize(base, "直径 ", "zh")), "直径 ");
  /// 封顶、不带换行
  const long = applyProductSize(base, `${"长".repeat(80)}\n第二行`, "zh");
  assert.equal(Array.from(detectProductSize(long) ?? "").length, PRODUCT_SIZE_MAX);
  /// 英文界面写的那一行，中文界面也认得、换得掉
  const english = applyProductSize(base, "about 8 cm across", "en");
  assert.equal(detectProductSize(english), "about 8 cm across");
  assert.equal(applyProductSize(english, "高 20 厘米", "zh"), `${base}\n商品实际大小：高 20 厘米`);
  /// 加上去会超上限：原样返回
  const nearLimit = "字".repeat(3995);
  assert.equal(applyProductSize(nearLimit, "直径约 8 厘米", "zh"), nearLimit);
});

test("尺寸行和「换个开头」互不打架：各换各的，另一行留着", () => {
  const base = "这只保温杯通勤用。";
  const both = applyHookAngle(applyProductSize(base, "直径约 8 厘米", "zh"), "pain", "zh");
  assert.equal(detectProductSize(both), "直径约 8 厘米");
  assert.equal(detectHookAngle(both), "pain");
  const resized = applyProductSize(both, "高 20 厘米", "zh");
  assert.equal(detectHookAngle(resized), "pain", "换尺寸不丢开头方向");
  assert.equal(detectProductSize(resized), "高 20 厘米");
  const rehooked = applyHookAngle(resized, "result", "zh");
  assert.equal(detectProductSize(rehooked), "高 20 厘米", "换开头不丢尺寸");
  assert.equal(stripProductSize(stripHookAngle(rehooked)), base);
});

test("创作页接线：空白页才摆最近的商品；三段进度跟着真实状态走", () => {
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /recentSources\.length > 0 && !storyboard && busy === null && !rawPrompt\.trim\(\) && productAssets\.length === 0/);
  /// 2026-11-10 商品档案：这一行现在既有存好的商品也有最近拍过的一单，去处由页面给；拍过的一单仍走「再做一条」那条路
  assert.match(studio, /<Link\s+href=\{source\.href\}/);
  const createPage = readFileSync("src/app/(platform)/app/create/page.tsx", "utf8");
  assert.match(createPage, /`\/app\/create\?retry=\$\{encodeURIComponent\(shortcut\.id\)\}`/, "走「再做一条」同一条路");
  assert.match(studio, /const storyboardStage = busy !== "storyboard" \? null : planningShots \? \(voiceoverDrafting \? 0 : 1\) : 2;/);
  assert.match(studio, /data-testid="storyboard-stages"/);
  assert.match(studio, /stages: \["写口播稿", "排镜头（约 40–60 秒）", "出故事板画面"\]/);
  assert.match(studio, /setRawPrompt\(applyProductSize\(rawPrompt, event\.target\.value, english \? "en" : "zh"\)\);\s+invalidatePlan\(\);/);
  assert.doesNotMatch(studio, /import (?!type )[^;]*from "@\/lib\/services\//, "客户端组件不引服务端模块");
  const page = readFileSync("src/app/(platform)/app/create/page.tsx", "utf8");
  assert.match(page, /routeState === "empty" \|\| result \|\| retryPrefill \|\| machinePrefill \|\| productPrefill\s+\? \[\]/, "带着预填进来的不查");
  /// 2026-11-10：改由 loadCreateShortcutsOrNone 读（存好的商品 + 最近拍过的），兜底仍在服务层
  assert.match(page, /await loadCreateShortcutsOrNone\(session\.user\.id\)/, "读不到就不显示，不拦创作");
  const shortcutService = readFileSync("src/lib/services/product-profile-service.ts", "utf8");
  assert.match(shortcutService, /console\.warn\("\[create\] recent sources unavailable:"/, "兜底时留一行日志");
  assert.doesNotMatch(page, /\.catch\(\(\)\s*=>\s*(?:\[\]|null)\)/, "页面里不把失败吞成空数据（RF-012）；兜底在服务层并记日志");
});
