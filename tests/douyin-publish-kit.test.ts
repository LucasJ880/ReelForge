/**
 * 抖音发布包的其余部件：文案起稿（LLM 失败不回退模板）、封面排版与合成、矩阵账号名单、
 * Aivora 尾卡内容、契约与接线。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import {
  AIVORA_MATRIX_END_CARD,
  BRAND_END_CARD_ENTRY_ENABLED,
  brandEndCardEntryEnabledFor,
} from "../src/lib/brand/brand-end-card-policy";
import { decideDouyinMatrixAccount, douyinMatrixAccounts } from "../src/lib/brand/douyin-matrix-access";
import {
  cleanHashtag,
  douyinCaptionText,
  douyinCopySchema,
  douyinKitRenderSchema,
  douyinKitRequestSchema,
} from "../src/lib/contracts/douyin-publish-kit";
import { DouyinCopyError, generateDouyinCopy } from "../src/lib/services/douyin-copy-service";
import { aivoraMatrixEndCardPlan } from "../src/lib/services/douyin-publish-kit-service";
import { __test__ as endCardTest } from "../src/lib/video-generation/brand-end-card-renderer";
import {
  buildCoverOverlaySvg,
  composeDouyinCover,
  coverOverlayLayout,
  coverTitleLines,
} from "../src/lib/video-generation/douyin-cover-compositor";
import { useBundledCjkFont } from "./helpers/synthetic-media";

const goodCopy = {
  title: "通勤路上一直在用的保温杯",
  body: "早上灌的热水，下午还是温的。杯口不烫嘴，单手就能开。",
  hashtags: ["保温杯", "通勤好物", "办公室日常"],
};

test("[douyin-copy] 走 fast 档；输出按契约校验并清洗话题", async () => {
  const calls: Array<{ tier: string; stage?: string; system: string; user: string }> = [];
  const { copy, modelUsed } = await generateDouyinCopy(
    { productBrief: "316 不锈钢保温杯，500ml", voiceoverScript: "一拧即开，随时补水。" },
    {
      chat: async (options) => {
        calls.push(options);
        return { data: { ...goodCopy, hashtags: ["#保温杯", " 通勤 好物 ", "＃办公室日常"] }, modelUsed: "fake-fast" };
      },
    },
  );
  assert.equal(modelUsed, "fake-fast");
  assert.deepEqual(copy.hashtags, ["保温杯", "通勤好物", "办公室日常"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tier, "fast");
  assert.equal(calls[0].stage, "douyin_publish_copy");
  assert.match(calls[0].system, /简体中文/);
  assert.match(calls[0].system, /严禁广告法极限词/);
  assert.match(calls[0].system, /严禁站外引流/);
  assert.match(calls[0].user, /316 不锈钢保温杯/);
  assert.match(calls[0].user, /一拧即开/);
});

test("[douyin-copy] LLM 失败 → 明确报错给用户，绝不回退到模板文案", async () => {
  await assert.rejects(
    generateDouyinCopy(
      { productBrief: "保温杯" },
      { chat: async () => { throw new Error("429 You exceeded your current quota"); } },
    ),
    (err: unknown) => {
      assert.ok(err instanceof DouyinCopyError);
      assert.equal(err.code, "LLM_UNAVAILABLE");
      assert.match(err.message, /文案生成失败/);
      assert.match(err.message, /手动填写/);
      assert.match(err.detail ?? "", /429/);
      return true;
    },
  );
  /// 输出不成形（话题太少 / 标题超长）同样是失败，不是「凑合用」
  for (const data of [
    { ...goodCopy, hashtags: ["保温杯"] },
    { ...goodCopy, title: "标".repeat(31) },
    { title: "只有标题的输出" },
    null,
  ]) {
    await assert.rejects(
      generateDouyinCopy({ productBrief: "保温杯" }, { chat: async () => ({ data, modelUsed: "fake" }) }),
      (err: unknown) => err instanceof DouyinCopyError && err.code === "LLM_INVALID_OUTPUT",
    );
  }
  await assert.rejects(
    generateDouyinCopy({ productBrief: "   " }, { chat: async () => ({ data: goodCopy, modelUsed: "fake" }) }),
    (err: unknown) => err instanceof DouyinCopyError && err.code === "INPUT_EMPTY",
  );
  /// 服务里没有任何兜底文案
  const source = readFileSync("src/lib/services/douyin-copy-service.ts", "utf8");
  /// 只有一个出口返回文案：LLM 的输出通过契约校验之后
  assert.equal((source.match(/return \{ copy:/g) ?? []).length, 1);
});

test("[douyin-kit] 契约：话题 3–5 个；整段文案；请求动作", () => {
  assert.equal(cleanHashtag(" ##保温 杯 "), "保温杯");
  assert.equal(douyinCopySchema.safeParse(goodCopy).success, true);
  assert.equal(douyinCopySchema.safeParse({ ...goodCopy, hashtags: ["a", "b"] }).success, false);
  assert.equal(douyinCopySchema.safeParse({ ...goodCopy, hashtags: ["a", "b", "c", "d", "e", "f"] }).success, false);
  assert.equal(
    douyinCaptionText(douyinCopySchema.parse(goodCopy)),
    `${goodCopy.title}\n${goodCopy.body}\n#保温杯 #通勤好物 #办公室日常`,
  );
  assert.equal(douyinKitRequestSchema.safeParse({ action: "copy" }).success, true);
  assert.equal(douyinKitRequestSchema.safeParse({ action: "unregister" }).success, true);
  assert.equal(douyinKitRequestSchema.safeParse({ action: "register", accountLabel: "号 A", publishUrl: "" }).success, true);
  assert.equal(douyinKitRequestSchema.safeParse({ action: "register", accountLabel: " " }).success, false);
  assert.equal(douyinKitRequestSchema.safeParse({ action: "register", accountLabel: "号 A", publishUrl: "不是网址" }).success, false);
  assert.equal(douyinKitRequestSchema.safeParse({ action: "render" }).success, false);
  const render = douyinKitRenderSchema.parse({ orderId: "order_1", copy: goodCopy });
  assert.equal(render.includeVideo, true);
});

test("[douyin-cover] 标题折行：最少行数、各行等宽不留单字尾行、优先标点后断、不拆英文、超长截断加省略号", () => {
  assert.deepEqual(coverTitleLines("保温杯"), ["保温杯"]);
  assert.deepEqual(coverTitleLines("三秒开盖，一手掌握"), ["三秒开盖，一手掌握"]);
  assert.deepEqual(coverTitleLines("通勤路上一直在用的保温杯"), ["通勤路上一直", "在用的保温杯"]);
  /// 之前的贪心折法会把「的」单独甩到第三行
  assert.deepEqual(coverTitleLines("通勤路上一直在用的保温杯，下午还是温的"), [
    "通勤路上一直",
    "在用的保温杯，",
    "下午还是温的",
  ]);
  /// 真机验收踩到的：等宽折法把「咖啡」劈开了，逗号就在后面一个字
  assert.deepEqual(coverTitleLines("早高峰带杯热咖啡，到工位还能喝"), ["早高峰带杯热咖啡，", "到工位还能喝"]);
  /// 标点不落行首
  for (const line of coverTitleLines("早上灌的热水到下午，还是温的")) assert.doesNotMatch(line, /^[，。！？、]/u);
  /// 英文单词 / 数字不拆（拉丁字符按半个字宽算）
  assert.deepEqual(coverTitleLines("Aivora 500ml 保温杯实测"), ["Aivora 500ml", "保温杯实测"]);
  const long = coverTitleLines("这是一个非常非常长的标题用来测试超过三行以后会不会被截断并且加上省略号");
  assert.equal(long.length, 3);
  assert.ok(long[2].endsWith("…"));
  for (const line of long) assert.ok(Array.from(line).length <= 9, line);
  /// 一个超长英文单词也不会抛错或超过三行
  assert.equal(coverTitleLines("Supercalifragilisticexpialidocious 保温杯").length, 3);
  assert.deepEqual(coverTitleLines("   "), []);
});

test("[douyin-cover] 版式：标题与标识都落在 3:4 居中裁切的可见区内；标识字高不低于短边 5%", () => {
  const layout = coverOverlayLayout({ width: 1080, height: 1920, lineCount: 3 });
  assert.equal(layout.safeTop, 240);
  assert.equal(layout.safeBottom, 1680);
  for (const baseline of layout.baselines) {
    assert.ok(baseline - layout.titleFontSize >= layout.safeTop, `baseline ${baseline}`);
    assert.ok(baseline + layout.titleFontSize * 0.3 <= layout.safeBottom, `baseline ${baseline}`);
  }
  assert.ok(layout.badgeFontSize * 0.9 >= 1080 * 0.05, `badge ${layout.badgeFontSize}`);
  const svg = buildCoverOverlaySvg({ width: 1080, height: 1920, title: "通勤路上一直在用的<保温杯> & 更多" });
  assert.match(svg, />AI生成<\/text>/);
  assert.match(svg, /&lt;保温杯&gt; &amp;/);
  assert.equal((svg.match(/text-anchor="middle"/g) ?? []).length, 2);
  /// 横版不裁
  const wide = coverOverlayLayout({ width: 1920, height: 1080, lineCount: 1 });
  assert.equal(wide.safeTop, 0);
  assert.equal(wide.safeBottom, 1080);
});

test("[douyin-cover] 确定性合成：同一帧 + 同一标题得到同一张封面，尺寸统一，标题区确实被画上了字", async (t) => {
  if (!useBundledCjkFont(t)) return t.skip("bundled CJK font not installed");
  const frame = await sharp({ create: { width: 720, height: 1280, channels: 3, background: { r: 20, g: 60, b: 110 } } })
    .png()
    .toBuffer();
  const first = await composeDouyinCover({ frame, title: goodCopy.title, width: 1080, height: 1920 });
  const second = await composeDouyinCover({ frame, title: goodCopy.title, width: 1080, height: 1920 });
  assert.deepEqual(first.lines, ["通勤路上一直", "在用的保温杯"]);
  assert.ok(first.jpeg.equals(second.jpeg), "同一输入两次合成的字节不一致");
  const meta = await sharp(first.jpeg).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.equal(meta.format, "jpeg");
  /// 标题区有白字（纯色底图上不可能自己出现亮像素）
  const layout = coverOverlayLayout({ width: 1080, height: 1920, lineCount: 2 });
  const region = await sharp(first.jpeg)
    .extract({ left: 100, top: layout.baselines[0] - layout.titleFontSize, width: 880, height: layout.lineHeight * 2 })
    .greyscale()
    .raw()
    .toBuffer();
  assert.ok(region.some((value) => value > 230), "标题区没有白字");
  const other = await composeDouyinCover({ frame, title: "换一个标题试试", width: 1080, height: 1920 });
  assert.ok(!other.jpeg.equals(first.jpeg));
  await assert.rejects(composeDouyinCover({ frame, title: "  ", width: 1080, height: 1920 }), /empty/);
});

test("[douyin-kit] Aivora 尾卡：只有品牌名和「主页看更多」，没有网址、联系方式", () => {
  assert.deepEqual(AIVORA_MATRIX_END_CARD, { brandName: "Aivora", cta: "主页看更多", durationSeconds: 2 });
  const plan = aivoraMatrixEndCardPlan();
  assert.equal(plan.mode, "auto_end_card");
  assert.equal(plan.brandName, "Aivora");
  assert.equal(plan.cta, "主页看更多");
  assert.equal(plan.website, null);
  assert.equal(plan.slogan, null);
  assert.deepEqual(plan.contactLines, []);
  /// 渲染器真正画出来的字只有这两行
  const svg = endCardTest.buildSvg({ briefId: "douyin-kit-test", plan, aspectRatio: "9:16" });
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
  assert.deepEqual(texts, ["Aivora", "主页看更多"]);
  assert.doesNotMatch(texts.join(" "), /https?:|www\.|\.com|\.app|二维码|微信|@/i);
});

test("[douyin-kit] 尾卡入口：对商家保持关闭，只有矩阵账号名单里的账号放开（名单为空 = 全关）", () => {
  assert.equal(BRAND_END_CARD_ENTRY_ENABLED, false);
  assert.equal(brandEndCardEntryEnabledFor({ matrixAccount: false }), false);
  assert.equal(brandEndCardEntryEnabledFor({ matrixAccount: true }), true);

  assert.deepEqual(douyinMatrixAccounts({}), []);
  assert.deepEqual(douyinMatrixAccounts({ DOUYIN_MATRIX_ACCOUNTS: " u_1 , Ops@Aivora.app ,," }), ["u_1", "ops@aivora.app"]);
  assert.equal(decideDouyinMatrixAccount({ userId: "u_1", allowed: [] }), false);
  assert.equal(decideDouyinMatrixAccount({ userId: "u_1", email: "ops@aivora.app", allowed: [] }), false);
  assert.equal(decideDouyinMatrixAccount({ userId: "u_1", allowed: ["u_1"] }), true);
  assert.equal(decideDouyinMatrixAccount({ userId: "u_2", email: " OPS@aivora.app ", allowed: ["ops@aivora.app"] }), true);
  assert.equal(decideDouyinMatrixAccount({ userId: "u_2", email: "merchant@example.com", allowed: ["u_1", "ops@aivora.app"] }), false);
});

test("[douyin-kit] 接线：导出素材挂在已打包 ffmpeg 的 /api/brand-packaging 上；面板不引服务端模块", () => {
  const brandRoute = readFileSync("src/app/api/brand-packaging/route.ts", "utf8");
  assert.match(brandRoute, /"douyinKit" in rawBody/);
  assert.match(brandRoute, /matrixAccount: await isDouyinMatrixAccount\(userId\)/);
  assert.match(brandRoute, /error\.code === "AD_LAW_TERMS" \? 422/);
  assert.match(brandRoute, /signal: request\.signal/);

  const service = readFileSync("src/lib/services/douyin-publish-kit-service.ts", "utf8");
  /// 极限词检查在产出任何素材之前
  assert.ok(service.indexOf("checkAdLawCopy(copy)") < service.indexOf("mkdtemp("));
  assert.match(service, /aiBadge: true/);
  assert.match(service, /platform: DOUYIN_PLATFORM/);
  assert.match(service, /if \(args\.matrixAccount\) \{/);

  const kitRoute = readFileSync("src/app/api/library/[id]/douyin-kit/route.ts", "utf8");
  assert.match(kitRoute, /platform: DOUYIN_PLATFORM/);
  assert.match(kitRoute, /err instanceof PublishAccountConflictError/);
  assert.match(kitRoute, /status: 409/);

  const panel = readFileSync("src/components/library/douyin-publish-kit.tsx", "utf8");
  assert.ok(panel.startsWith('"use client";'));
  assert.doesNotMatch(panel, /@\/lib\/services\/|@\/lib\/db|douyin-matrix-access|@\/lib\/providers\//);
  assert.match(panel, /matrixAccount: boolean/);
  const copy = readFileSync("src/i18n/douyin-kit-copy.ts", "utf8");
  assert.match(copy, /发布时请勾选『内容由 AI 生成』声明/);
});
