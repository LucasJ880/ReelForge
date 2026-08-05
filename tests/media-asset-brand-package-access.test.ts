import assert from "node:assert/strict";
import test from "node:test";
import {
  MediaAssetNotFoundError,
  __setMediaAssetRepositoryForTests,
  resolveOwnedMediaAssets,
} from "../src/lib/services/media-asset-service";

const OWNED = {
  id: "owned-1",
  userId: "user-1",
  workspaceId: null,
  storageKey: "uploads/owned-1.png",
  url: "https://blob.example/owned-1.png",
  mimeType: "image/png",
  byteSize: 10,
  sha256: "aa",
  width: 100,
  height: 100,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const GLOBAL_LOGO = {
  ...OWNED,
  id: "global-logo-1",
  userId: "aivora-ops",
  storageKey: "seed/global-brand/logo.png",
  url: "https://blob.example/global-logo.png",
};

test("brand-package assets from visible packages resolve for non-owners (0805 walkthrough fix)", async () => {
  __setMediaAssetRepositoryForTests({
    create: async () => {
      throw new Error("not used");
    },
    findMany: async ({ where }) =>
      where.id.in.includes("owned-1") && where.userId === "user-1"
        ? [OWNED]
        : [],
    findVisibleBrandPackageAssets: async ({ assetIds }) =>
      assetIds.includes("global-logo-1") ? [GLOBAL_LOGO] : [],
  });
  try {
    const resolved = await resolveOwnedMediaAssets({
      userId: "user-1",
      assetIds: ["owned-1", "global-logo-1"],
    });
    assert.deepEqual(
      resolved.map((r) => r.id),
      ["owned-1", "global-logo-1"],
    );
  } finally {
    __setMediaAssetRepositoryForTests(null);
  }
});

test("assets outside ownership and visible brand packages still 404", async () => {
  __setMediaAssetRepositoryForTests({
    create: async () => {
      throw new Error("not used");
    },
    findMany: async () => [],
    findVisibleBrandPackageAssets: async () => [],
  });
  try {
    await assert.rejects(
      resolveOwnedMediaAssets({ userId: "user-1", assetIds: ["stranger-1"] }),
      MediaAssetNotFoundError,
    );
  } finally {
    __setMediaAssetRepositoryForTests(null);
  }
});

test("legacy repository doubles without the optional hook keep strict-ownership semantics", async () => {
  __setMediaAssetRepositoryForTests({
    create: async () => {
      throw new Error("not used");
    },
    findMany: async () => [],
  });
  try {
    await assert.rejects(
      resolveOwnedMediaAssets({ userId: "user-1", assetIds: ["global-logo-1"] }),
      MediaAssetNotFoundError,
    );
  } finally {
    __setMediaAssetRepositoryForTests(null);
  }
});
