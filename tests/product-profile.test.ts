import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PRODUCT_IMAGES_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_SELLING_POINTS_MAX,
  productDraftFromPrompt,
  productProfileCreateSchema,
  productProfilePatchSchema,
  productProfilePrompt,
} from "../src/lib/contracts/product-profile";
import { applyHookAngle } from "../src/lib/create/hook-angles";
import { PLATFORM_PRIMARY_NAV } from "../src/lib/platform-routes";

/**
 * 2026-11-10 商品档案：常拍的商品存一次（名字、卖点、尺寸、商品图），以后点一下就带进创作页。
 * 独立新表、没有外键、不物理删除；全部按属主读写。
 */

test("新建：要名字和至少一张商品图；图去重；多余字段不收", () => {
  const ok = productProfileCreateSchema.parse({
    name: "  三支装丝绒唇釉 ",
    sellingPoints: " 玫瑰、珊瑚、浆果三个颜色。 ",
    size: "",
    imageAssetIds: ["a1", "a2", "a1"],
  });
  assert.deepEqual(ok, {
    kind: "manual",
    name: "三支装丝绒唇釉",
    sellingPoints: "玫瑰、珊瑚、浆果三个颜色。",
    size: null,
    imageAssetIds: ["a1", "a2"],
  });
  /// 卖点、尺寸可以不带
  assert.equal(productProfileCreateSchema.parse({ name: "保温杯", imageAssetIds: ["a1"] }).kind, "manual");
  const bad = [
    { name: "", imageAssetIds: ["a1"] },
    { name: "保温杯", imageAssetIds: [] },
    { name: "字".repeat(PRODUCT_NAME_MAX + 1), imageAssetIds: ["a1"] },
    { name: "保温杯", sellingPoints: "字".repeat(PRODUCT_SELLING_POINTS_MAX + 1), imageAssetIds: ["a1"] },
    { name: "保温杯", imageAssetIds: Array.from({ length: PRODUCT_IMAGES_MAX + 1 }, (_, index) => `a${index}`) },
    { name: "保温杯", imageAssetIds: ["a1"], userId: "someone-else" },
    { name: "保温杯", imageAssetIds: ["a1"], fromOrderId: "o1" },
    null,
  ];
  for (const input of bad) assert.equal(productProfileCreateSchema.safeParse(input).success, false, JSON.stringify(input));
});

test("新建：也可以把拍过的一单存成档案（只带订单号）", () => {
  assert.deepEqual(productProfileCreateSchema.parse({ fromOrderId: " order-1 " }), { kind: "import", orderId: "order-1" });
  assert.equal(productProfileCreateSchema.safeParse({ fromOrderId: "" }).success, false);
});

test("修改：只改带上的字段；空补丁不收；尺寸传空串是清掉；归档只认 true", () => {
  assert.deepEqual(productProfilePatchSchema.parse({ name: "新名字" }), {
    name: "新名字",
    sellingPoints: undefined,
    size: undefined,
    imageAssetIds: undefined,
    archived: false,
  });
  assert.equal(productProfilePatchSchema.parse({ size: "" }).size, null);
  assert.equal(productProfilePatchSchema.parse({ size: "直径约 8 厘米" }).size, "直径约 8 厘米");
  assert.equal(productProfilePatchSchema.parse({ archived: true }).archived, true);
  assert.deepEqual(productProfilePatchSchema.parse({ imageAssetIds: ["a", "a", "b"] }).imageAssetIds, ["a", "b"]);
  for (const input of [{}, { archived: false }, { imageAssetIds: [] }, { name: "" }, { userId: "x" }]) {
    assert.equal(productProfilePatchSchema.safeParse(input).success, false, JSON.stringify(input));
  }
});

test("带进创作页的那段话：名字：卖点，尺寸另起一行；卖点已经以名字开头就不重复", () => {
  const product = { name: "三支装丝绒唇釉", sellingPoints: "玫瑰、珊瑚、浆果三个颜色。", size: "每支长约 8 厘米" };
  assert.equal(
    productProfilePrompt(product, "zh"),
    "三支装丝绒唇釉：玫瑰、珊瑚、浆果三个颜色。\n商品实际大小：每支长约 8 厘米",
  );
  assert.equal(productProfilePrompt({ ...product, size: null }, "zh"), "三支装丝绒唇釉：玫瑰、珊瑚、浆果三个颜色。");
  assert.equal(productProfilePrompt({ name: "保温杯", sellingPoints: "", size: null }, "zh"), "保温杯");
  assert.equal(
    productProfilePrompt({ name: "保温杯", sellingPoints: "保温杯，装热水六小时还烫嘴。", size: null }, "zh"),
    "保温杯，装热水六小时还烫嘴。",
  );
  assert.equal(
    productProfilePrompt({ name: "Travel mug", sellingPoints: "Keeps coffee hot for six hours.", size: "fits a cup holder" }, "en"),
    "Travel mug: Keeps coffee hot for six hours.\nActual product size: fits a cup holder",
  );
});

test("从拍过的描述拆草稿：去掉开头方向和尺寸行，第一句当名字，尺寸单独取出", () => {
  const prompt = applyHookAngle(
    "三支装丝绒唇釉：玫瑰、珊瑚、浆果三个颜色。想拍一个女生出门前试色。\n商品实际大小：每支长约 8 厘米",
    "pain",
    "zh",
  );
  const draft = productDraftFromPrompt(prompt);
  assert.equal(draft.name, "三支装丝绒唇釉");
  assert.equal(draft.size, "每支长约 8 厘米");
  assert.equal(draft.sellingPoints, "三支装丝绒唇釉：玫瑰、珊瑚、浆果三个颜色。想拍一个女生出门前试色。");
  /// 没有标点的一句话：整句当名字（截到上限）
  assert.equal(productDraftFromPrompt("一只会自己加热的保温杯").name, "一只会自己加热的保温杯");
  assert.equal(Array.from(productDraftFromPrompt("字".repeat(80)).name).length, PRODUCT_NAME_MAX);
  assert.deepEqual(productDraftFromPrompt("  "), { name: "", sellingPoints: "", size: null });
});

test("迁移：只新建一张独立的表，可重复执行，不动任何既有表", () => {
  const sql = readFileSync("prisma/migrations/20261110190000_product_profile/migration.sql", "utf8");
  const statements = sql.replace(/^--.*$/gmu, "");
  assert.match(statements, /CREATE TABLE IF NOT EXISTS "ProductProfile"/);
  assert.match(statements, /CREATE INDEX IF NOT EXISTS "ProductProfile_userId_archivedAt_updatedAt_idx"/);
  assert.doesNotMatch(statements, /\b(?:DROP|ALTER|REFERENCES|DELETE|TRUNCATE|UPDATE)\b/u);
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const model = schema.slice(schema.indexOf("model ProductProfile {"), schema.indexOf("enum AdEditPlanStatus {"));
  assert.match(model, /imageAssetIds String\[\]\s+@default\(\[\]\)/);
  assert.match(model, /archivedAt\s+DateTime\?/);
  assert.doesNotMatch(model, /@relation/, "没有外键：表没建时只有这一页不可用");
});

test("服务层：全部按属主读写；归档不删除；存图前核对是本人的图片；表没建时如实报不可用", () => {
  const service = readFileSync("src/lib/services/product-profile-service.ts", "utf8");
  assert.doesNotMatch(service, /productProfile\.(?:delete|deleteMany)\(/);
  for (const where of [
    /findMany\(\{\s+where: \{ userId, archivedAt: null \}/,
    /count\(\{ where: \{ userId, archivedAt: null \} \}\)/,
    /updateMany\(\{ where: \{ id, userId, archivedAt: null \}, data \}\)/,
    /findFirst\(\{ where: \{ id, userId, archivedAt: null \}, select: ROW_SELECT \}\)/,
  ]) assert.match(service, where);
  assert.match(service, /patch\.archived \? \{ archivedAt: new Date\(\) \}/);
  assert.match(service, /where: \{ id: \{ in: ids \}, userId \}/, "图片只认本人的素材");
  assert.match(service, /if \(assetIds\.some\(\(assetId\) => !images\.has\(assetId\)\)\) throw new ProductProfileImagesError\(\);/);
  assert.match(service, /error\.code === "P2021" \|\| error\.code === "P2022"/);
  /// 从拍过的一单存：走按属主校验的那条已有的路
  assert.match(service, /await loadCreateRetryPrefill\(input\.orderId, userId\)/);
  /// 页面数据：表没建 → available=false，不吞成「你还没有商品」
  assert.match(service, /return \{ available: false, products: \[\], suggestions: \[\] \};/);
});

test("接口：先鉴权、再校验、再调服务；找不到 / 没开通 / 图不可用各有各的答复", () => {
  const list = readFileSync("src/app/api/products/route.ts", "utf8");
  const one = readFileSync("src/app/api/products/[id]/route.ts", "utf8");
  for (const [source, parse, call] of [
    [list.slice(list.indexOf("export async function POST")), "productProfileCreateSchema.safeParse", "createProductProfile("],
    [one, "productProfilePatchSchema.safeParse", "updateProductProfile("],
  ] as const) {
    const auth = source.indexOf("await requireAuth()");
    assert.ok(auth >= 0 && auth < source.indexOf(parse) && source.indexOf(parse) < source.indexOf(call));
    assert.match(source, /if \(!auth\.ok\) return auth\.response;/);
    assert.doesNotMatch(source, /from "@\/lib\/db"/, "路由不直接碰库");
  }
  assert.match(list, /await listProductProfiles\(auth\.session\.user\.id\)/);
  assert.match(one, /code: "NOT_FOUND"[^\n]*\{ status: 404 \}/);
  assert.match(one, /code: "UNAVAILABLE"[^\n]*\{ status: 503 \}/);
  assert.match(list, /code: "INVALID_IMAGES"[^\n]*\{ status: 400 \}/);
  assert.match(list, /code: "LIMIT_REACHED"[^\n]*\{ status: 409 \}/);
});

test("导航：商品在资产组里、成品库和品牌之间；页面标题跟导航名走", () => {
  const ids = PLATFORM_PRIMARY_NAV.map((item) => item.id);
  assert.deepEqual(ids.slice(ids.indexOf("library"), ids.indexOf("library") + 3), ["library", "products", "brands"]);
  assert.equal(PLATFORM_PRIMARY_NAV.find((item) => item.id === "products")?.href, "/app/products");
  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  assert.match(shell, /\{ id: "assets", items: \["library", "products", "brands", "templates"\] \}/);
  assert.match(shell, /products: Package,/);
  const page = readFileSync("src/app/(platform)/app/products/page.tsx", "utf8");
  assert.match(page, /nav="products"/);
  assert.match(page, /readings=\{\[\]\}/, "没有能接着做什么的数字就不放读数");
  assert.match(page, /library\.available \? <NewProductButton/);
  assert.doesNotMatch(page, /\.catch\(\(\) =>/, "RF-012：页面加载器不把失败吞成空数据");
});

test("商品页组件：客户端文件不引服务端模块；归档要先确认；关掉编辑框会取消上传", () => {
  const ui = readFileSync("src/components/products/product-library.tsx", "utf8");
  assert.match(ui, /^"use client";/);
  assert.doesNotMatch(ui, /from "@\/lib\/(?:services|db|ai|providers)/);
  assert.match(ui, /<ConfirmDialog[\s\S]{0,200}testId="product-archive-confirm"/);
  assert.match(ui, /useEffect\(\(\) => \(\) => uploads\.current\?\.abort\(\), \[\]\);/);
  assert.match(ui, /uploadBlobWithProgress\(\{ file, signal: controller\.signal \}\)/, "上传走直传（不过函数，没有 4.5MB 上限）");
  assert.match(ui, /href=\{`\/app\/create\?product=\$\{encodeURIComponent\(product\.id\)\}`\}/);
});

test("创作页：?product= 带入商品图和那段话；「接着拍」先放存好的商品", () => {
  const page = readFileSync("src/app/(platform)/app/create/page.tsx", "utf8");
  assert.match(page, /await loadProductProfilePrefill\(session\.user\.id, product\)/);
  assert.match(page, /productProfilePrompt\(productPrefill, locale === "en-US" \? "en" : "zh"\)/);
  assert.match(page, /await loadCreateShortcutsOrNone\(session\.user\.id\)/);
  assert.match(page, /`\/app\/create\?product=\$\{encodeURIComponent\(shortcut\.id\)\}`/);
  assert.match(page, /`\/app\/create\?retry=\$\{encodeURIComponent\(shortcut\.id\)\}`/);
  const service = readFileSync("src/lib/services/product-profile-service.ts", "utf8");
  const shortcuts = service.slice(service.indexOf("export async function loadCreateShortcutsOrNone"));
  assert.ok(shortcuts.indexOf('kind: "product"') < shortcuts.indexOf('kind: "order"'), "商品在前，最近拍过的补位");
  assert.match(shortcuts, /unsavedSources\(await listRecentCreateSources\(userId, limit \* 2\), products\)/);
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /<Link\s+href=\{source\.href\}/);
  assert.match(studio, /href="\/app\/products"/);
  /// 带着商品进来时，「已载入」那句话说的是这件商品，不是照搬产品图工作台那句
  assert.match(page, /loadedProductName=\{productAssets\.length > 0 && !result && retryAssets\.length === 0 \? productPrefill\?\.name \?\? null : null\}/);
  const notice = studio.slice(studio.indexOf("loadedFromStudio.length > 0 ? ("), studio.indexOf("{!storyboard ? statusNotices : null}"));
  assert.ok(notice.indexOf("loadedProductName ? (") < notice.indexOf("retryOfOrderId || machineTaskId ? ("));
  assert.match(notice, /已载入「\$\{loadedProductName\}」的 \$\{loadedFromStudio\.length\} 张商品图。接着写这次想怎么拍。/);
});
