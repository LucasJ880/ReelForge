import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  compositeAnchorOnto,
  maskCoverageInBox,
  maskFromAlpha,
  MIN_BOX_COVERAGE,
  parseStoredLogoBox,
  toEditableMask,
} from "../src/lib/services/product-anchor-service";
import {
  availableCutoutProvider,
  cutoutProduct,
  CutoutFailedError,
  CutoutUnavailableError,
  roiFormValue,
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

test("remove.bg roi：框选的产品区域转成百分比矩形，防生活场景照抠错主体", async () => {
  await withEnv({ REMOVE_BG_API_KEY: "k", CLIPDROP_API_KEY: undefined }, async () => {
    let form: FormData | null = null;
    await cutoutProduct(Buffer.from("src"), {
      roi: { x: 0.1, y: 0.2, width: 0.5, height: 0.7 },
      fetchImpl: (async (_url: string | URL, init?: RequestInit) => {
        form = init?.body as FormData;
        return new Response(new Uint8Array(Buffer.from("png")), { status: 200 });
      }) as typeof fetch,
    });
    /// 必须是整数百分比：带小数会被 remove.bg 拒 invalid_roi（0803 真机踩到）。
    assert.equal(form!.get("roi"), "10% 20% 60% 90%");

    /// 不传 roi 时不能出现该字段：保持与既有调用方（含 B1 验收脚本）兼容。
    await cutoutProduct(Buffer.from("src"), {
      fetchImpl: (async (_url: string | URL, init?: RequestInit) => {
        form = init?.body as FormData;
        return new Response(new Uint8Array(Buffer.from("png")), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(form!.get("roi"), null);
  });
});

test("roi 越界值钳在 0-100%，不给上游喂坏参数", () => {
  assert.equal(
    roiFormValue({ x: -0.2, y: 0, width: 1.5, height: 1.2 }),
    "0% 0% 100% 100%",
  );
  /// 起点向下、终点向上取整：框只放大不缩小，产品边缘不会被裁进背景。
  assert.equal(
    roiFormValue({ x: 0.2379, y: 0.2031, width: 0.314, height: 0.35 }),
    "23% 20% 56% 56%",
  );
});

test("logoBoxJson 防御性解析：坏数据当没有，宁可全图抠", () => {
  assert.deepEqual(
    parseStoredLogoBox({ x: 0.1, y: 0.2, width: 0.5, height: 0.7 }),
    { x: 0.1, y: 0.2, width: 0.5, height: 0.7 },
  );
  assert.equal(parseStoredLogoBox(null), null);
  assert.equal(parseStoredLogoBox("box"), null);
  assert.equal(parseStoredLogoBox({ x: 0.1, y: 0.2 }), null);
  assert.equal(parseStoredLogoBox({ x: 0.1, y: 0.2, width: Number.NaN, height: 0.5 }), null);
  assert.equal(parseStoredLogoBox({ x: 0.8, y: 0.2, width: 0.5, height: 0.5 }), null, "超出右边界");
  assert.equal(parseStoredLogoBox({ x: 0.1, y: 0.2, width: 0, height: 0.5 }), null, "零宽");
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

test("框内覆盖率：框住产品 ≈ 1，框在空角落 ≈ 0（错主体的判据）", async () => {
  /// 200x200 图，产品圆在中心 (100,100) r=60。
  const mask = await maskFromAlpha(await makeRgba());
  const around = await maskCoverageInBox(mask, {
    x: 0.15, y: 0.15, width: 0.7, height: 0.7,
  });
  assert.ok(around > 0.99, `框住产品应接近 1，实际 ${around}`);
  const corner = await maskCoverageInBox(mask, {
    x: 0.0, y: 0.0, width: 0.15, height: 0.15,
  });
  assert.ok(corner < 0.01, `空角落应接近 0，实际 ${corner}`);
  assert.ok(corner < MIN_BOX_COVERAGE && around >= MIN_BOX_COVERAGE);
});

test("roi 被拒时退回全图抠 + 框内覆盖率校验兜底（0803 UI 验收实测）", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/product-anchor-service.ts"),
    "utf8",
  );
  /// 贴边产品（窗帘整窗照）加 roi 后 remove.bg 报 unknown_foreground，
  /// 连近全幅框都失败；退回全图抠后必须用框做事后校验，错主体不做假成功。
  assert.match(source, /unknown_foreground/);
  assert.match(source, /maskCoverageInBox\(mask, box\)/);
  assert.match(source, /MIN_BOX_COVERAGE/);
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

/* ── P02-E0 · 已就绪锚点查找 + cron 接线（2026-10-26）─────────────────── */

import { NextRequest } from "next/server";
import {
  ANCHOR_CLAIM_MIN_AGE_MS,
  ANCHOR_CUTOUT_CRON_BUDGET_MS,
  ANCHOR_CUTOUT_CRON_LIMIT,
  findReadyAnchorCutoutsForImages,
  isAnchorCutoutCronEnabled,
  pendingAnchorWhere,
  processPendingAnchors,
  runCutoutDetailed,
  sweepProductAnchorCutouts,
  type AnchorLookupClient,
  type CutoutOutcome,
  type RunCutoutDeps,
} from "../src/lib/services/product-anchor-service";
import * as pollVideosRoute from "../src/app/api/cron/poll-videos/route";

type AnchorRow = { id: string; userId: string; status: string; sourceImageUrl: string; cutoutUrl: string | null };
type AssetRow = { userId: string; url: string; sha256: string };

/** 内存版 Prisma 子集：按 where 真正过滤，并记录每次查询的 where，验证 userId 收窄。 */
function fakeClient(anchors: AnchorRow[], assets: AssetRow[]) {
  const wheres: Array<Record<string, unknown>> = [];
  const client = {
    productAnchor: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        wheres.push(args.where);
        const where = args.where as {
          userId: string;
          status: string;
          cutoutUrl: { not: null };
          sourceImageUrl: { in: string[] };
        };
        return anchors
          .filter(
            (row) =>
              row.userId === where.userId &&
              row.status === where.status &&
              row.cutoutUrl !== null &&
              where.sourceImageUrl.in.includes(row.sourceImageUrl),
          )
          .map(({ id, sourceImageUrl, cutoutUrl }) => ({ id, sourceImageUrl, cutoutUrl }));
      },
    },
    mediaAsset: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        wheres.push(args.where);
        const where = args.where as { userId: string; url?: { in: string[] }; sha256?: { in: string[] } };
        return assets
          .filter(
            (row) =>
              row.userId === where.userId &&
              (!where.url || where.url.in.includes(row.url)) &&
              (!where.sha256 || where.sha256.in.includes(row.sha256)),
          )
          .map(({ url, sha256 }) => ({ url, sha256 }));
      },
    },
  };
  return { client: client as unknown as AnchorLookupClient, wheres };
}

const U = "user-a";
const ANCHORS: AnchorRow[] = [
  { id: "anc-1", userId: U, status: "READY", sourceImageUrl: "https://blob/u-a/mug-v1.jpg", cutoutUrl: "https://blob/anchors/anc-1/cutout.png" },
  { id: "anc-2", userId: U, status: "PENDING_CUTOUT", sourceImageUrl: "https://blob/u-a/lamp.jpg", cutoutUrl: null },
  { id: "anc-3", userId: U, status: "FAILED", sourceImageUrl: "https://blob/u-a/chair.jpg", cutoutUrl: null },
  { id: "anc-x", userId: "user-b", status: "READY", sourceImageUrl: "https://blob/u-b/mug.jpg", cutoutUrl: "https://blob/anchors/anc-x/cutout.png" },
];
const ASSETS: AssetRow[] = [
  { userId: U, url: "https://blob/u-a/mug-v1.jpg", sha256: "sha-mug" },
  { userId: U, url: "https://blob/u-a/mug-reupload.jpg", sha256: "sha-mug" },
  { userId: U, url: "https://blob/u-a/lamp.jpg", sha256: "sha-lamp" },
  { userId: "user-b", url: "https://blob/u-b/mug.jpg", sha256: "sha-mug" },
];

test("锚点查找：按 sourceImageUrl 精确匹配 READY 锚点；PENDING / FAILED 不算；顺序跟输入一致、去重；返回调用方的原串", async () => {
  const { client, wheres } = fakeClient(ANCHORS, ASSETS);
  const hits = await findReadyAnchorCutoutsForImages(
    U,
    ["https://blob/u-a/lamp.jpg", " https://blob/u-a/mug-v1.jpg ", "https://blob/u-a/mug-v1.jpg", "  "],
    client,
  );
  assert.deepEqual(hits, [
    { imageUrl: " https://blob/u-a/mug-v1.jpg ", cutoutUrl: "https://blob/anchors/anc-1/cutout.png", anchorId: "anc-1" },
  ]);
  assert.ok(wheres.every((where) => where.userId === U), "每次查询都先按 userId 收窄");
});

test("锚点查找：地址对不上就用 MediaAsset.sha256 兜底——同一张图重新上传换了 blob 地址仍能命中", async () => {
  const { client } = fakeClient(ANCHORS, ASSETS);
  const hits = await findReadyAnchorCutoutsForImages(U, ["https://blob/u-a/mug-reupload.jpg"], client);
  assert.deepEqual(hits, [
    { imageUrl: "https://blob/u-a/mug-reupload.jpg", cutoutUrl: "https://blob/anchors/anc-1/cutout.png", anchorId: "anc-1" },
  ]);
});

test("锚点查找：sha256 相同但属于别的商家 → 不借用；没有 MediaAsset 记录的外链 → 空", async () => {
  const { client } = fakeClient(ANCHORS, ASSETS);
  const own = await findReadyAnchorCutoutsForImages("user-b", ["https://blob/u-b/mug.jpg"], client);
  assert.deepEqual(own.map((hit) => hit.anchorId), ["anc-x"]);
  const stranger = await findReadyAnchorCutoutsForImages("user-c", ["https://blob/u-a/mug-v1.jpg", "https://blob/u-a/mug-reupload.jpg"], client);
  assert.deepEqual(stranger, []);
  assert.deepEqual(await findReadyAnchorCutoutsForImages(U, ["https://cdn.example.com/external.jpg"], client), []);
  assert.deepEqual(await findReadyAnchorCutoutsForImages(U, [], client), []);
  assert.deepEqual(await findReadyAnchorCutoutsForImages("", ["https://blob/u-a/mug-v1.jpg"], client), []);
});

/* ── runCutout：原子认领 / 账户拒绝 / 超时 ─────────────────────────── */

const T0 = new Date("2026-10-26T08:00:00.000Z");

type FakeAnchor = {
  id: string; userId: string; sku: string; sourceImageUrl: string; cutoutUrl: string | null; maskUrl: string | null;
  logoBoxJson: unknown; brandName: string | null; status: string; cutoutProvider: string | null; failureReason: string | null;
  createdAt: Date; updatedAt: Date;
};

/** 单行内存版 productAnchor：updateMany 真按 where 的 id / status / updatedAt 做 CAS，没显式给 updatedAt 就自动 +1ms（模拟 @updatedAt）。 */
function fakeAnchorStore(overrides: Partial<FakeAnchor> = {}) {
  const row: FakeAnchor = {
    id: "anc-pending", userId: U, sku: "mug", sourceImageUrl: "https://blob/u-a/mug.jpg", cutoutUrl: null, maskUrl: null,
    logoBoxJson: null, brandName: null, status: "PENDING_CUTOUT", cutoutProvider: null, failureReason: null,
    createdAt: T0, updatedAt: T0, ...overrides,
  };
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    productAnchor: {
      findUniqueOrThrow: async () => ({ ...row }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const sameTime = (a: unknown, b: Date) => a instanceof Date && a.getTime() === b.getTime();
        const matches =
          (where.id === undefined || where.id === row.id) &&
          (where.status === undefined || where.status === row.status) &&
          (where.updatedAt === undefined || sameTime(where.updatedAt, row.updatedAt));
        if (!matches) return { count: 0 };
        updates.push(data);
        Object.assign(row, data);
        if (!("updatedAt" in data)) row.updatedAt = new Date(row.updatedAt.getTime() + 1);
        return { count: 1 };
      },
    },
  };
  return { client: client as unknown as RunCutoutDeps["client"], row, updates };
}

function okSource(): typeof fetch {
  return (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch;
}

const fakeStorage = (() => ({
  uploadBuffer: async (_bucket: string, _buffer: Buffer, options: { key: string }) => ({ url: `https://blob/${options.key}` }),
})) as unknown as RunCutoutDeps["storage"];

function ticking(start = T0.getTime() + 60_000) {
  let t = start;
  return () => new Date((t += 1000));
}

test("并发认领：两路同时跑同一个锚点，只有一路真的付费抠图，另一路拿到 not_claimed", async () => {
  const store = fakeAnchorStore();
  let cutoutCalls = 0;
  const deps: Partial<RunCutoutDeps> = {
    client: store.client,
    fetchImpl: okSource(),
    cutout: (async () => {
      cutoutCalls += 1;
      return { rgba: await makeRgba(), provider: "remove_bg" as const };
    }) as RunCutoutDeps["cutout"],
    storage: fakeStorage,
    now: ticking(),
  };
  const [a, b] = await Promise.all([runCutoutDetailed("anc-pending", { deps }), runCutoutDetailed("anc-pending", { deps })]);
  assert.deepEqual([a.outcome, b.outcome].sort(), ["not_claimed", "ready"]);
  assert.equal(cutoutCalls, 1, "同一张图只付一次抠图费");
  assert.equal(store.row.status, "READY");
  assert.equal(store.row.cutoutUrl, "https://blob/product-anchors/anc-pending/cutout.png");
  assert.equal(store.row.maskUrl, "https://blob/product-anchors/anc-pending/mask.png");
  assert.equal(store.row.failureReason, null);
});

test("供应商按账户拒绝（401 / 402 / 403）：锚点保持 PENDING_CUTOUT、写明原因；500 才是这张图的 FAILED", async () => {
  for (const status of [401, 402, 403]) {
    const store = fakeAnchorStore();
    const result = await runCutoutDetailed("anc-pending", {
      deps: {
        client: store.client,
        fetchImpl: okSource(),
        cutout: (async () => {
          throw new CutoutFailedError("remove_bg", `HTTP ${status} insufficient credits`, status);
        }) as RunCutoutDeps["cutout"],
        storage: fakeStorage,
        now: ticking(),
      },
    });
    assert.equal(result.outcome, "pending_provider_rejected", String(status));
    assert.equal(store.row.status, "PENDING_CUTOUT", `${status} 不是这张图的问题，不许打成 FAILED`);
    assert.match(store.row.failureReason ?? "", new RegExp(`HTTP ${status}`));
  }
  const store = fakeAnchorStore();
  const failed = await runCutoutDetailed("anc-pending", {
    deps: {
      client: store.client,
      fetchImpl: okSource(),
      cutout: (async () => {
        throw new CutoutFailedError("remove_bg", "HTTP 500 upstream", 500);
      }) as RunCutoutDeps["cutout"],
      storage: fakeStorage,
      now: ticking(),
    },
  });
  assert.equal(failed.outcome, "failed");
  assert.equal(store.row.status, "FAILED");
});

test("硬超时：AbortSignal 一路传到原图 fetch；到点中止 → 锚点保持 PENDING、原因写「本轮超时」", async () => {
  const store = fakeAnchorStore();
  let sawSignal: AbortSignal | undefined;
  const hanging: typeof fetch = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      sawSignal = init?.signal ?? undefined;
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as typeof fetch;
  let cutoutCalls = 0;
  /// 不用 AbortSignal.timeout：它的计时器是 unref 的，测试里没有别的 I/O 挂着，事件循环会先空掉
  /// （生产里有真实 fetch 保活，不受影响）。这里用带 ref 的 setTimeout 手动 abort。
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 30);
  const result = await runCutoutDetailed("anc-pending", {
    signal: controller.signal,
    deps: {
      client: store.client,
      fetchImpl: hanging,
      cutout: (async () => {
        cutoutCalls += 1;
        return { rgba: await makeRgba(), provider: "remove_bg" as const };
      }) as RunCutoutDeps["cutout"],
      storage: fakeStorage,
      now: ticking(),
    },
  });
  clearTimeout(abortTimer);
  assert.ok(sawSignal instanceof AbortSignal, "原图 fetch 必须收到 signal");
  assert.equal(result.outcome, "pending_timeout");
  assert.equal(store.row.status, "PENDING_CUTOUT");
  assert.match(store.row.failureReason ?? "", /超时/);
  assert.equal(cutoutCalls, 0);
});

test("cron 带 claimToken：令牌对不上（期间被重新锚定 / 别人认领）就不跑；落库前被重新锚定则放弃结果不覆盖新图", async () => {
  const store = fakeAnchorStore();
  let cutoutCalls = 0;
  const cutout = (async () => {
    cutoutCalls += 1;
    return { rgba: await makeRgba(), provider: "remove_bg" as const };
  }) as RunCutoutDeps["cutout"];
  const stale = await runCutoutDetailed("anc-pending", {
    claimToken: new Date(T0.getTime() + 5),
    deps: { client: store.client, fetchImpl: okSource(), cutout, storage: fakeStorage, now: ticking() },
  });
  assert.equal(stale.outcome, "not_claimed");
  assert.equal(cutoutCalls, 0);

  /// 认领成功、抠图进行中，商家换图重新锚定（upsert 改了 updatedAt 与 sourceImageUrl）
  const reanchored = await runCutoutDetailed("anc-pending", {
    claimToken: T0,
    deps: {
      client: store.client,
      fetchImpl: okSource(),
      cutout: (async () => {
        store.row.sourceImageUrl = "https://blob/u-a/mug-v2.jpg";
        store.row.updatedAt = new Date(T0.getTime() + 99_000);
        return { rgba: await makeRgba(), provider: "remove_bg" as const };
      }) as RunCutoutDeps["cutout"],
      storage: fakeStorage,
      now: ticking(),
    },
  });
  assert.equal(reanchored.outcome, "not_claimed");
  assert.equal(store.row.status, "PENDING_CUTOUT", "旧图的切片不许盖到新图的锚点上");
  assert.equal(store.row.cutoutUrl, null);
});

/* ── processPendingAnchors / sweep ─────────────────────────────────── */

function runnerFor(args: {
  claimed: string[] | null;
  outcomes?: Record<string, CutoutOutcome>;
  stepMs?: number;
  onRun?: (id: string, options: { signal: AbortSignal; claimToken: Date }) => void;
}) {
  let clock = 1_000_000;
  const ran: string[] = [];
  const claims: Array<{ limit: number; olderThan: Date; claimAt: Date }> = [];
  return {
    ran,
    claims,
    runner: {
      claimPending: async (claimArgs: { limit: number; olderThan: Date; claimAt: Date }) => {
        claims.push(claimArgs);
        return args.claimed;
      },
      runCutout: async (id: string, options: { signal: AbortSignal; claimToken: Date }) => {
        ran.push(id);
        args.onRun?.(id, options);
        clock += args.stepMs ?? 0;
        return { outcome: args.outcomes?.[id] ?? ("ready" as const) };
      },
      now: () => clock,
    },
  };
}

test("processPendingAnchors：认领窗口 = updatedAt 早于两分钟；每个锚点收到 signal 与同一个 claimToken", async () => {
  const seen: Array<{ signal: AbortSignal; claimToken: Date }> = [];
  const h = runnerFor({ claimed: ["a", "b"], onRun: (_id, options) => seen.push(options) });
  const result = await processPendingAnchors(5, { runner: h.runner, budgetMs: 1000 });
  assert.deepEqual(result, { scanned: 2, processed: 2, ready: 2, budgetExhausted: false, locked: false, abortedBy: null });
  assert.equal(h.claims.length, 1);
  assert.equal(h.claims[0]!.limit, 5);
  assert.equal(h.claims[0]!.claimAt.getTime(), 1_000_000);
  assert.equal(h.claims[0]!.olderThan.getTime(), 1_000_000 - ANCHOR_CLAIM_MIN_AGE_MS);
  assert.ok(seen.every((item) => item.signal instanceof AbortSignal && item.claimToken.getTime() === 1_000_000));
  assert.deepEqual(pendingAnchorWhere(new Date(123)), { status: "PENDING_CUTOUT", updatedAt: { lt: new Date(123) } });
});

test("processPendingAnchors：预算到点就停、没拿到锁就什么都不做、账户拒绝整轮中止", async () => {
  const budget = runnerFor({ claimed: ["a", "b", "c", "d"], stepMs: 600 });
  const exhausted = await processPendingAnchors(5, { runner: budget.runner, budgetMs: 1000 });
  assert.deepEqual(budget.ran, ["a", "b"], "第三个开始前已过预算");
  assert.equal(exhausted.budgetExhausted, true);
  assert.equal(exhausted.processed, 2);

  const locked = runnerFor({ claimed: null });
  const lockedResult = await processPendingAnchors(5, { runner: locked.runner, budgetMs: 1000 });
  assert.equal(lockedResult.locked, true);
  assert.deepEqual(locked.ran, []);

  const rejected = runnerFor({ claimed: ["a", "b", "c"], outcomes: { a: "ready", b: "pending_provider_rejected" } });
  const aborted = await processPendingAnchors(5, { runner: rejected.runner, budgetMs: 1000 });
  assert.deepEqual(rejected.ran, ["a", "b"], "402 之后不再逐个去打供应商");
  assert.equal(aborted.abortedBy, "provider_rejected");
  assert.equal(aborted.ready, 1);

  const timedOut = runnerFor({ claimed: ["a", "b"], outcomes: { a: "pending_timeout" } });
  const stopped = await processPendingAnchors(5, { runner: timedOut.runner, budgetMs: 1000 });
  assert.deepEqual(timedOut.ran, ["a"]);
  assert.equal(stopped.budgetExhausted, true);
});

test("cron 开关：PRODUCT_ANCHOR_CUTOUT_CRON 默认关，on / 1 / true 才开；每轮 5 个 / 20s", () => {
  assert.equal(isAnchorCutoutCronEnabled({}), false);
  assert.equal(isAnchorCutoutCronEnabled({ PRODUCT_ANCHOR_CUTOUT_CRON: "off" }), false);
  assert.equal(isAnchorCutoutCronEnabled({ PRODUCT_ANCHOR_CUTOUT_CRON: "on" }), true);
  assert.equal(isAnchorCutoutCronEnabled({ PRODUCT_ANCHOR_CUTOUT_CRON: " ON " }), true);
  assert.equal(isAnchorCutoutCronEnabled({ PRODUCT_ANCHOR_CUTOUT_CRON: "1" }), true);
  assert.equal(isAnchorCutoutCronEnabled({ PRODUCT_ANCHOR_CUTOUT_CRON: "true" }), true);
  assert.equal(ANCHOR_CUTOUT_CRON_LIMIT, 5);
  assert.equal(ANCHOR_CUTOUT_CRON_BUDGET_MS, 20_000);
});

test("cron 一轮：开关关 → 不碰库；没 key → 跳过；能力状态暂停 / 未开通 → 跳过；都齐了 → 5 个 / 20s 预算 + signal", async () => {
  let runs = 0;
  const debug: string[] = [];
  const log = { debug: (message: string) => debug.push(message) };
  const run = async (limit: number, options: { budgetMs: number; signal: AbortSignal }) => {
    runs += 1;
    assert.equal(limit, 5);
    assert.equal(options.budgetMs, 20_000);
    assert.ok(options.signal instanceof AbortSignal);
    return { scanned: 2, processed: 2, ready: 1, budgetExhausted: false, locked: false, abortedBy: null };
  };
  const available = async () => "available" as const;

  const off = await sweepProductAnchorCutouts({ env: {}, isCutoutAvailable: () => true, cutoutCapabilityStatus: available, processPendingAnchors: run, log });
  assert.deepEqual(off, { enabled: false, reason: "flag_off" });

  const noKey = await sweepProductAnchorCutouts({
    env: { PRODUCT_ANCHOR_CUTOUT_CRON: "on" }, isCutoutAvailable: () => false, cutoutCapabilityStatus: available, processPendingAnchors: run, log,
  });
  assert.deepEqual(noKey, { enabled: false, reason: "cutout_unavailable" });
  assert.match(debug.at(-1)!, /抠图能力不可用/);

  for (const status of ["unavailable", "not_configured"] as const) {
    const paused = await sweepProductAnchorCutouts({
      env: { PRODUCT_ANCHOR_CUTOUT_CRON: "on" }, isCutoutAvailable: () => true, cutoutCapabilityStatus: async () => status, processPendingAnchors: run, log,
    });
    assert.deepEqual(paused, { enabled: false, reason: "cutout_capability_paused" }, status);
  }
  assert.equal(runs, 0, "以上情况都不许去跑抠图");

  const on = await sweepProductAnchorCutouts({
    env: { PRODUCT_ANCHOR_CUTOUT_CRON: "on" }, isCutoutAvailable: () => true, cutoutCapabilityStatus: available, processPendingAnchors: run, log,
  });
  assert.deepEqual(on, { enabled: true, deadlineHit: false, scanned: 2, processed: 2, ready: 1, budgetExhausted: false, locked: false, abortedBy: null });
  assert.equal(runs, 1);
});

test("cron 一轮：硬 deadline——某一步不认 signal 也要按时交还，带着已完成的计数回来", async () => {
  const started = Date.now();
  const result = await sweepProductAnchorCutouts({
    env: { PRODUCT_ANCHOR_CUTOUT_CRON: "on" },
    isCutoutAvailable: () => true,
    cutoutCapabilityStatus: async () => "available",
    budgetMs: 30,
    graceMs: 20,
    log: { debug: () => undefined },
    processPendingAnchors: (_limit, options) => {
      options.progress.scanned = 3;
      options.progress.processed = 1;
      options.progress.ready = 1;
      return new Promise(() => undefined);
    },
  });
  assert.ok(Date.now() - started < 1000, "不能等到那个永不返回的 Promise");
  assert.deepEqual(result, { enabled: true, deadlineHit: true, scanned: 3, processed: 1, ready: 1, budgetExhausted: true, locked: false, abortedBy: null });
});

test("poll-videos cron 把锚点续跑放进同一个 allSettled：结果进响应，失败只算 degraded 不拖垮视频轮询", async () => {
  const base = {
    machineAuthFailure: () => null,
    startSchedulerHeartbeat: (() => ({ finish: (status: string) => ({ status }) })) as never,
    pollRunningJobs: async () => ({ polled: 0, updated: 0 }) as never,
    pollPendingProductImageJobs: async () => ({ polled: 0, recovered: 0 }) as never,
    pollPendingStoryboardRuns: async () => 0 as never,
    pollPendingContentPostRenders: async () => 0,
    sweepStuckTasks: async () => ({}) as never,
  };
  const sweep = { enabled: true as const, deadlineHit: false, scanned: 3, processed: 3, ready: 2, budgetExhausted: false, locked: false, abortedBy: null };
  const handler = pollVideosRoute.createPollVideosHandler({
    ...base,
    sweepProductAnchorCutouts: async () => sweep,
  });
  const response = await handler(new NextRequest("http://localhost/api/cron/poll-videos"));
  const body = (await response.json()) as { anchorCutout?: unknown; anchorCutoutError?: unknown; degraded?: boolean };
  assert.equal(response.status, 200);
  assert.deepEqual(body.anchorCutout, sweep);
  assert.equal(body.anchorCutoutError, null);
  assert.equal(body.degraded, false);

  const failing = pollVideosRoute.createPollVideosHandler({
    ...base,
    sweepProductAnchorCutouts: async () => {
      throw new Error("remove.bg 402");
    },
  });
  const failed = await failing(new NextRequest("http://localhost/api/cron/poll-videos"));
  const failedBody = (await failed.json()) as { anchorCutout?: unknown; anchorCutoutError?: string; degraded?: boolean };
  assert.equal(failed.status, 200, "锚点续跑失败不是视频轮询失败");
  assert.equal(failedBody.anchorCutout, null);
  assert.match(failedBody.anchorCutoutError ?? "", /402/);
  assert.equal(failedBody.degraded, true);

  const route = readFileSync(path.join(process.cwd(), "src/app/api/cron/poll-videos/route.ts"), "utf8");
  assert.match(route, /dependencies\.sweepProductAnchorCutouts\(\)/);
});
