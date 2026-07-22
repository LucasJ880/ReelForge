import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { uploadBlobSuccessSchema } from "../src/lib/contracts/upload-blob";

test("upload succeeds without invoking AI review", async () => {
  const [uploadRoute, productImageRoute] = await Promise.all([
    readFile("src/app/api/upload/blob/route.ts", "utf8"),
    readFile("src/app/api/product-images/route.ts", "utf8"),
  ]);

  for (const source of [uploadRoute, productImageRoute]) {
    assert.doesNotMatch(source, /reviewMediaOrThrow/);
  }
  assert.match(uploadRoute, /createOwnedMediaAsset/);
  assert.match(productImageRoute, /resolveOwnedImageAssets/);

  const response = uploadBlobSuccessSchema.parse({
    ok: true,
    asset: {
      id: "asset-owned-by-server",
      url: "https://assets.example.test/uploads/reference.png",
      mimeType: "image/png",
      width: 1,
      height: 1,
    },
  });
  assert.equal(response.ok, true);
  assert.ok(response.asset.id);
});

test("media asset persistence hashes bytes and inspects image dimensions", async () => {
  const {
    __setMediaAssetRepositoryForTests,
    createOwnedMediaAsset,
  } = await import("../src/lib/services/media-asset-service");

  const writes: Array<Record<string, unknown>> = [];
  __setMediaAssetRepositoryForTests({
    async create(args) {
      writes.push(args.data);
      return {
        id: "asset-1",
        ...args.data,
        createdAt: new Date("2026-07-22T19:00:00.000Z"),
        updatedAt: new Date("2026-07-22T19:00:00.000Z"),
      };
    },
    async findMany() {
      return [];
    },
  });

  try {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const asset = await createOwnedMediaAsset({
      userId: "user-a",
      workspaceId: "workspace-a",
      storageKey: "uploads/user-a/reference.png",
      url: "https://assets.example.test/uploads/user-a/reference.png",
      mimeType: "image/png",
      bytes: png,
    });

    assert.equal(asset.width, 1);
    assert.equal(asset.height, 1);
    assert.equal(writes[0]?.byteSize, png.byteLength);
    assert.equal(
      writes[0]?.sha256,
      "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
    );
  } finally {
    __setMediaAssetRepositoryForTests(null);
  }
});

test("active creation upload consumers use the server-issued asset ID", async () => {
  const [xhr, uploadAssets, batchWizard, singleStudio, imageStudio] = await Promise.all([
    readFile("src/lib/upload/blob-xhr.ts", "utf8"),
    readFile("src/components/personal/upload-assets.ts", "utf8"),
    readFile("src/components/batch/batch-create-wizard.tsx", "utf8"),
    readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8"),
    readFile("src/components/product-images/product-image-studio.tsx", "utf8"),
  ]);

  assert.match(xhr, /payload\.asset\?\.id/);
  assert.match(
    xhr,
    /resolve\(\{[\s\S]*assetId: payload\.asset\.id,[\s\S]*url: payload\.asset\.url/,
  );
  assert.doesNotMatch(xhr, /!payload\.url/);

  assert.match(uploadAssets, /assetId: asset\.id/);
  assert.match(uploadAssets, /id: asset\.id/);
  assert.match(uploadAssets, /url: asset\.url/);

  assert.match(batchWizard, /assetId: data\.assetId/);
  assert.match(batchWizard, /assetIds: uploaded\.map/);
  assert.doesNotMatch(batchWizard, /images: uploaded\.map/);

  assert.match(singleStudio, /toOwnedCreationRequest/);
  assert.match(imageStudio, /asset\?: AssetView/);
  assert.match(imageStudio, /sourceAssetId: sourceAsset\?\.id/);
});
