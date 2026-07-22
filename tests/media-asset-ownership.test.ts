import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { batchCreateRequestSchema } from "../src/lib/contracts/batch-request";
import { unifiedVideoGenerationRequestSchema } from "../src/lib/schemas/unified-input";

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

test("new creation contracts require server-owned IDs and reject raw external URLs", () => {
  const unifiedBase = {
    userType: "platform",
    rawPrompt: "Create a product launch video",
    selectedDuration: 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "none",
  };
  const ownedAttachment = {
    assetId: "asset-owned",
    inferredRole: "product_image",
    roleConfidence: 1,
    fileName: "product.png",
    durationSeconds: null,
    userAssignedRole: "product_image",
  };
  assert.equal(
    unifiedVideoGenerationRequestSchema.safeParse({
      ...unifiedBase,
      attachments: [ownedAttachment],
    }).success,
    true,
  );
  assert.equal(
    unifiedVideoGenerationRequestSchema.safeParse({
      ...unifiedBase,
      attachments: [
        {
          ...ownedAttachment,
          assetId: undefined,
          url: "https://attacker.example/foreign.png",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    unifiedVideoGenerationRequestSchema.safeParse({
      ...unifiedBase,
      attachments: [],
      brandKit: { logoUrl: "file:///etc/passwd" },
    }).success,
    false,
  );

  const batchBase = {
    templateId: "template-1",
    templateVersion: 1,
    requestedCount: 1,
  };
  assert.equal(
    batchCreateRequestSchema.safeParse({
      ...batchBase,
      assetIds: ["asset-owned"],
    }).success,
    true,
  );
  assert.equal(
    batchCreateRequestSchema.safeParse({
      ...batchBase,
      images: [
        { id: "forged", url: "https://attacker.example/foreign.png" },
      ],
    }).success,
    false,
  );
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
  const [planRoute, dispatchRoute, batchRoute] = await Promise.all([
    readFile("src/app/api/video-generation/plan/route.ts", "utf8"),
    readFile("src/app/api/video-generation/dispatch/route.ts", "utf8"),
    readFile("src/app/api/batches/route.ts", "utf8"),
  ]);

  const planResolve = planRoute.indexOf("await resolveOwnedCreationRequest");
  assert.ok(planResolve >= 0);
  assert.ok(planResolve < planRoute.indexOf("await assertQuotaForSession"));
  assert.ok(planResolve < planRoute.indexOf("await buildPlan"));

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

  const batchResolve = batchRoute.indexOf("await resolveOwnedImageAssets");
  assert.ok(batchResolve >= 0);
  assert.ok(batchResolve < batchRoute.indexOf("await createBatchJob"));
  assert.ok(batchResolve < batchRoute.indexOf("await authorizeBatchQuotaForSession"));
  assert.ok(batchResolve < batchRoute.indexOf("await processBatchTick"));

  const digitalHumanRoute = await readFile(
    "src/app/api/digital-human/jobs/route.ts",
    "utf8",
  );
  assert.match(digitalHumanRoute, /storeImageAssetIds/);
  assert.doesNotMatch(digitalHumanRoute, /storeImageUrls: z\.array/);
  assert.ok(
    digitalHumanRoute.indexOf("await resolveOwnedImageAssets") <
      digitalHumanRoute.indexOf("await assertQuotaForSession"),
  );
});
