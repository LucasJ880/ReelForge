import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("task input cannot resolve another user's asset", async () => {
  const {
    __setMediaAssetRepositoryForTests,
    resolveOwnedMediaAssets,
  } = await import("../src/lib/services/media-asset-service");

  const ownedByUserA = {
    id: "asset-user-a",
    userId: "user-a",
    workspaceId: null,
    storageKey: "uploads/user-a/private.png",
    url: "https://assets.example.test/uploads/user-a/private.png",
    mimeType: "image/png",
    byteSize: 68,
    sha256: "sha-user-a",
    width: 1,
    height: 1,
    createdAt: new Date("2026-07-22T19:00:00.000Z"),
    updatedAt: new Date("2026-07-22T19:00:00.000Z"),
  };

  __setMediaAssetRepositoryForTests({
    async create(args) {
      return {
        id: "created-asset",
        ...args.data,
        createdAt: new Date("2026-07-22T19:00:00.000Z"),
        updatedAt: new Date("2026-07-22T19:00:00.000Z"),
      };
    },
    async findMany(args) {
      return args.where.userId === ownedByUserA.userId &&
        args.where.id.in.includes(ownedByUserA.id)
        ? [ownedByUserA]
        : [];
    },
  });

  try {
    await assert.rejects(
      resolveOwnedMediaAssets({
        userId: "user-b",
        assetIds: [ownedByUserA.id],
      }),
      /not found/i,
    );
  } finally {
    __setMediaAssetRepositoryForTests(null);
  }
});

test("owned asset resolution preserves requested order and duplicates", async () => {
  const {
    __setMediaAssetRepositoryForTests,
    resolveOwnedMediaAssets,
  } = await import("../src/lib/services/media-asset-service");

  const records = ["asset-a", "asset-b"].map((id) => ({
    id,
    userId: "user-a",
    workspaceId: null,
    storageKey: `uploads/user-a/${id}.png`,
    url: `https://assets.example.test/uploads/user-a/${id}.png`,
    mimeType: "image/png",
    byteSize: 68,
    sha256: `sha-${id}`,
    width: 1,
    height: 1,
    createdAt: new Date("2026-07-22T19:00:00.000Z"),
    updatedAt: new Date("2026-07-22T19:00:00.000Z"),
  }));

  __setMediaAssetRepositoryForTests({
    async create(args) {
      return {
        id: "created-asset",
        ...args.data,
        createdAt: new Date("2026-07-22T19:00:00.000Z"),
        updatedAt: new Date("2026-07-22T19:00:00.000Z"),
      };
    },
    async findMany(args) {
      return records.filter(
        (record) =>
          record.userId === args.where.userId &&
          args.where.id.in.includes(record.id),
      );
    },
  });

  try {
    const resolved = await resolveOwnedMediaAssets({
      userId: "user-a",
      assetIds: ["asset-b", "asset-a", "asset-b"],
    });
    assert.deepEqual(
      resolved.map((asset) => asset.id),
      ["asset-b", "asset-a", "asset-b"],
    );
  } finally {
    __setMediaAssetRepositoryForTests(null);
  }
});

test("batch image resolution rejects owned non-image media", async () => {
  const {
    __setMediaAssetRepositoryForTests,
    resolveOwnedImageAssets,
  } = await import("../src/lib/services/media-asset-service");

  __setMediaAssetRepositoryForTests({
    async create(args) {
      return {
        id: "created-asset",
        ...args.data,
        createdAt: new Date("2026-07-22T19:00:00.000Z"),
        updatedAt: new Date("2026-07-22T19:00:00.000Z"),
      };
    },
    async findMany() {
      return [{
        id: "owned-video",
        userId: "user-a",
        workspaceId: null,
        storageKey: "uploads/user-a/video.mp4",
        url: "https://assets.example.test/video.mp4",
        mimeType: "video/mp4",
        byteSize: 1024,
        sha256: "sha-video",
        width: null,
        height: null,
        createdAt: new Date("2026-07-22T19:00:00.000Z"),
        updatedAt: new Date("2026-07-22T19:00:00.000Z"),
      }];
    },
  });

  try {
    await assert.rejects(
      resolveOwnedImageAssets({ userId: "user-a", assetIds: ["owned-video"] }),
      /image/i,
    );
  } finally {
    __setMediaAssetRepositoryForTests(null);
  }
});

test("creation routes resolve ownership before quota, persistence, or provider work", async () => {
  const [ dispatchRoute] = await Promise.all([
    readFile("src/app/api/video-generation/dispatch/route.ts", "utf8"),
  ]);

  const dispatchResolve = dispatchRoute.indexOf("await resolveOwnedCreationRequest");
  assert.ok(dispatchResolve >= 0);
  assert.ok(dispatchResolve < dispatchRoute.indexOf("videoRouteSnapshot = selectVideoRouteSnapshot"));
  assert.ok(dispatchResolve < dispatchRoute.indexOf("await buildPlan"));
  const orderResolve = dispatchRoute.indexOf("await db.deliveryOrder.findFirst");
  assert.ok(orderResolve >= 0);
  assert.match(dispatchRoute, /createdById: session\.user\.id/);
  assert.match(
    dispatchRoute,
    /const isInternalStaff =\s*session\.user\.role === "OPERATOR" \|\| session\.user\.role === "SUPER_ADMIN"/,
  );
  assert.doesNotMatch(
    dispatchRoute,
    /const isInternalStaff =\s*sessionPersona ===/,
  );
  assert.ok(orderResolve < dispatchRoute.indexOf("videoRouteSnapshot = selectVideoRouteSnapshot"));
  assert.ok(orderResolve < dispatchRoute.indexOf("await buildPlan"));
  assert.ok(orderResolve < dispatchRoute.indexOf("await assertQuotaBatchForSession"));
  /// 数字人 jobs 路由 2026-10-28 随封存链删除。
});
