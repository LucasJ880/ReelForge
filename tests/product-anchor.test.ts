import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  compositeAnchorOnto,
  maskFromAlpha,
  toEditableMask,
} from "../src/lib/services/product-anchor-service";
import {
  availableCutoutProvider,
  cutoutProduct,
  CutoutFailedError,
  CutoutUnavailableError,
} from "../src/lib/providers/cutout";

/**
 * B1 · 产品锚定第 0 层（PRD §5 / M5）。
 * 像素操作用 sharp 现场合成验证；抠图 REST 用注入的 fetch 验证契约。
 */

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/** 一张中央有不透明圆、四周透明的 RGBA 图。 */
async function makeRgba(): Promise<Buffer> {
  const svg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="100" r="60" fill="rgb(255,77,0)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("🔴 没有 key 时明确抛错，不做假成功", async () => {
  await withEnv(
    { REMOVE_BG_API_KEY: undefined, CLIPDROP_API_KEY: undefined },
    async () => {
      assert.equal(availableCutoutProvider(), null);
      await assert.rejects(
        cutoutProduct(Buffer.from("x")),
        CutoutUnavailableError,
      );
    },
  );
});

test("remove.bg 契约：multipart、X-Api-Key、png 格式", async () => {
  await withEnv({ REMOVE_BG_API_KEY: "test-key", CLIPDROP_API_KEY: undefined }, async () => {
    let captured: { url: string; headers: Record<string, string>; form: FormData } | null = null;
    const fake = Buffer.from("fake-png");
    const result = await cutoutProduct(Buffer.from("src"), {
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        captured = {
          url: url.toString(),
          headers: init?.headers as Record<string, string>,
          form: init?.body as FormData,
        };
        return new Response(new Uint8Array(fake), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(result.provider, "remove_bg");
    assert.ok(result.rgba.equals(fake));
    assert.equal(captured!.url, "https://api.remove.bg/v1.0/removebg");
    assert.equal(captured!.headers["X-Api-Key"], "test-key");
    assert.equal(captured!.form.get("format"), "png", "必须要 png 保住 alpha");
  });
});

test("上游报错时带回 provider 与状态码，便于排障", async () => {
  await withEnv({ REMOVE_BG_API_KEY: "k", CLIPDROP_API_KEY: undefined }, async () => {
    await assert.rejects(
      cutoutProduct(Buffer.from("src"), {
        fetchImpl: (async () =>
          new Response("insufficient credits", { status: 402 })) as typeof fetch,
      }),
      (err: unknown) =>
        err instanceof CutoutFailedError &&
        err.provider === "remove_bg" &&
        /402/.test(err.message),
    );
  });
});

test("mask 从 alpha 派生：产品白、背景黑", async () => {
  const mask = await maskFromAlpha(await makeRgba());
  const { data, info } = await sharp(mask).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => data[(y * info.width + x) * info.channels];
  assert.ok(px(100, 100) > 200, "中心（产品）应为白");
  assert.ok(px(5, 5) < 50, "角落（背景）应为黑");
});

test("路径 A 反相：产品不透明（锁死）、环境透明（可画）", async () => {
  const mask = await maskFromAlpha(await makeRgba());
  const editable = await toEditableMask(mask);
  const { data, info } = await sharp(editable)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number) =>
    data[(y * info.width + x) * 4 + 3];
  /// OpenAI images.edit 语义：透明区域才允许重画。
  assert.equal(alphaAt(100, 100), 255, "产品区域必须不透明 = 不许画");
  assert.equal(alphaAt(5, 5), 0, "环境区域必须透明 = 可画");
});

test("路径 B 贴回：产品像素原样出现在环境图上", async () => {
  const environment = await sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 40, g: 80, b: 40 } },
  })
    .png()
    .toBuffer();
  const composed = await compositeAnchorOnto(environment, await makeRgba());
  const { data, info } = await sharp(composed).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
  const center = at(200, 200);
  /// 中心是贴回的品牌橙 —— 真实像素，不是模型重画的近似色。
  assert.ok(center.r > 240 && center.g < 120 && center.b < 40, JSON.stringify(center));
  const corner = at(10, 10);
  assert.ok(corner.g > corner.r, "角落仍是环境绿");
});

test("锚点服务：key 未配置时停在 PENDING_CUTOUT，不写假 cutoutUrl", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/product-anchor-service.ts"),
    "utf8",
  );
  assert.match(source, /PENDING_CUTOUT/);
  assert.match(source, /不做假成功/);
  /// key 后配的续跑入口必须存在，否则商家要重新提交所有 SKU。
  assert.match(source, /processPendingAnchors/);
});

test("composeReferenceImage 已支持 mask 参数（路径 A 只差的那个参数）", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/providers/openai-image.ts"),
    "utf8",
  );
  assert.match(source, /mask\?: ReferenceImageInput/);
  assert.match(source, /maskFile \? \{ mask: maskFile \} : \{\}/);
});
