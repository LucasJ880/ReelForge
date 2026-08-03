import assert from "node:assert/strict";
import test from "node:test";

import { createProductAnchorPostHandler } from "../src/app/api/product-anchors/route";
import { createProductAnchorRetryHandler } from "../src/app/api/product-anchors/[id]/retry/route";
import { MediaAssetNotFoundError } from "../src/lib/services/media-asset-service";

/**
 * B1 · /api/product-anchors 路由边界（PRD §5 / M5）。
 * 依赖注入验证：demo 拦截先于一切付费路径、校验先于 service、
 * 归属失败 404、READY 短路不重复扣抠图费。
 */

const VALID_BOX = { x: 0.1, y: 0.2, width: 0.5, height: 0.7 };

function session(user: { id: string; email: string }) {
  return async () => ({ ok: true as const, session: { user } as never });
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/product-anchors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function anchorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "anchor-1",
    userId: "user-1",
    sku: "roman-shade",
    brandName: "SunnyShutter",
    sourceImageUrl: "https://assets.example.test/source.png",
    cutoutUrl: null,
    maskUrl: null,
    logoBoxJson: VALID_BOX,
    status: "PENDING_CUTOUT",
    cutoutProvider: null,
    failureReason: null,
    createdAt: new Date("2026-08-03T00:00:00Z"),
    updatedAt: new Date("2026-08-03T00:00:00Z"),
    ...overrides,
  } as never;
}

test("🔴 demo 账号在解析入参之前就被拦下，不触发任何付费路径", async () => {
  const calls: string[] = [];
  const handler = createProductAnchorPostHandler({
    requireAuth: session({ id: "demo-user", email: "demo@aivora.app" }),
    listProductAnchorsForUser: async () => { calls.push("list"); return []; },
    resolveOwnedImageAssets: async () => { calls.push("resolve"); return [] as never; },
    createProductAnchor: async () => { calls.push("create"); return anchorRow(); },
  });
  const response = await handler(postRequest({
    sku: "roman-shade", sourceAssetId: "asset-1", logoBox: VALID_BOX,
  }) as never);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "DEMO_BLOCKED");
  assert.deepEqual(calls, []);
});

test("缺 logoBox（产品区域框）是校验错误，不落库", async () => {
  const calls: string[] = [];
  const handler = createProductAnchorPostHandler({
    requireAuth: session({ id: "user-1", email: "merchant@example.test" }),
    listProductAnchorsForUser: async () => { calls.push("list"); return []; },
    resolveOwnedImageAssets: async () => { calls.push("resolve"); return [] as never; },
    createProductAnchor: async () => { calls.push("create"); return anchorRow(); },
  });
  const response = await handler(postRequest({
    sku: "roman-shade", sourceAssetId: "asset-1",
  }) as never);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "VALIDATION_FAILED");
  assert.deepEqual(calls, []);
});

test("happy path：service 收到的是服务端资产 URL，不是客户端提交的任何 URL", async () => {
  let received: Record<string, unknown> | null = null;
  const handler = createProductAnchorPostHandler({
    requireAuth: session({ id: "user-1", email: "merchant@example.test" }),
    listProductAnchorsForUser: async () => [],
    resolveOwnedImageAssets: async () =>
      [{ id: "asset-1", url: "https://assets.example.test/owned.png" }] as never,
    createProductAnchor: async (args) => {
      received = args as never;
      return anchorRow({ sourceImageUrl: args.sourceImageUrl, status: "READY" });
    },
  });
  const response = await handler(postRequest({
    sku: "roman-shade",
    brandName: "SunnyShutter",
    sourceAssetId: "asset-1",
    logoBox: VALID_BOX,
  }) as never);
  assert.equal(response.status, 201);
  assert.equal(received!.sourceImageUrl, "https://assets.example.test/owned.png");
  assert.deepEqual(received!.logoBox, VALID_BOX);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.anchor.status, "READY");
  assert.deepEqual(payload.anchor.logoBox, VALID_BOX);
});

test("资产不存在或不属于当前用户 → 404，不泄露存在性", async () => {
  const handler = createProductAnchorPostHandler({
    requireAuth: session({ id: "user-1", email: "merchant@example.test" }),
    listProductAnchorsForUser: async () => [],
    resolveOwnedImageAssets: async () => { throw new MediaAssetNotFoundError(); },
    createProductAnchor: async () => { throw new Error("must not run"); },
  });
  const response = await handler(postRequest({
    sku: "roman-shade", sourceAssetId: "someone-elses", logoBox: VALID_BOX,
  }) as never);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "RESOURCE_NOT_FOUND");
});

test("锚点上限挡新 SKU，但同 SKU 重锚（替换语义）不受限", async () => {
  const existing = Array.from({ length: 50 }, (_, index) =>
    anchorRow({ id: `anchor-${index}`, sku: `sku-${index}` }),
  );
  const deps = {
    requireAuth: session({ id: "user-1", email: "merchant@example.test" }),
    listProductAnchorsForUser: async () => existing as never,
    resolveOwnedImageAssets: async () =>
      [{ id: "asset-1", url: "https://assets.example.test/owned.png" }] as never,
    createProductAnchor: async () => anchorRow({ sku: "sku-3" }),
  };
  const blocked = await createProductAnchorPostHandler(deps)(postRequest({
    sku: "brand-new-sku", sourceAssetId: "asset-1", logoBox: VALID_BOX,
  }) as never);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "ANCHOR_LIMIT_REACHED");

  const replaced = await createProductAnchorPostHandler(deps)(postRequest({
    sku: "sku-3", sourceAssetId: "asset-1", logoBox: VALID_BOX,
  }) as never);
  assert.equal(replaced.status, 201);
});

function retryContext(id = "anchor-1") {
  return { params: Promise.resolve({ id }) };
}

const retryRequest = new Request("http://localhost/api/product-anchors/anchor-1/retry", {
  method: "POST",
});

test("retry：demo 拦截、归属 404、READY 短路都不触发抠图", async () => {
  const calls: string[] = [];
  const demoBlocked = await createProductAnchorRetryHandler({
    requireAuth: session({ id: "demo-user", email: "demo@aivora.app" }),
    getOwnedProductAnchor: async () => anchorRow(),
    runCutout: async () => { calls.push("cutout"); return anchorRow(); },
  })(retryRequest as never, retryContext());
  assert.equal(demoBlocked.status, 403);

  const notOwned = await createProductAnchorRetryHandler({
    requireAuth: session({ id: "user-1", email: "merchant@example.test" }),
    getOwnedProductAnchor: async () => null,
    runCutout: async () => { calls.push("cutout"); return anchorRow(); },
  })(retryRequest as never, retryContext());
  assert.equal(notOwned.status, 404);

  const ready = await createProductAnchorRetryHandler({
    requireAuth: session({ id: "user-1", email: "merchant@example.test" }),
    getOwnedProductAnchor: async () => anchorRow({ status: "READY" }),
    runCutout: async () => { calls.push("cutout"); return anchorRow(); },
  })(retryRequest as never, retryContext());
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).anchor.status, "READY");

  assert.deepEqual(calls, [], "三条路径都不允许触发付费抠图");
});

test("retry：FAILED 锚点原地重跑并返回最新状态", async () => {
  let cutoutFor: string | null = null;
  const response = await createProductAnchorRetryHandler({
    requireAuth: session({ id: "user-1", email: "merchant@example.test" }),
    getOwnedProductAnchor: async () => anchorRow({ status: "FAILED", failureReason: "原图取不到：HTTP 502" }),
    runCutout: async (anchorId) => {
      cutoutFor = anchorId;
      return anchorRow({
        status: "READY",
        cutoutUrl: "https://assets.example.test/cutout.png",
        cutoutProvider: "remove_bg",
      });
    },
  })(retryRequest as never, retryContext());
  assert.equal(response.status, 200);
  assert.equal(cutoutFor, "anchor-1");
  const payload = await response.json();
  assert.equal(payload.anchor.status, "READY");
  assert.equal(payload.anchor.cutoutProvider, "remove_bg");
});
