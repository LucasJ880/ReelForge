import assert from "node:assert/strict";
import test from "node:test";

import { createUploadBlobPostHandler } from "../src/app/api/upload/blob/route";
import { validateMediaMagicBytes } from "../src/lib/upload/media-file-validation";

/// JFIF 头：手机相册 / 微信转存常见的「.png 名字、JPEG 内容」。
const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

test("1025：扩展名与内容不符的受支持图片被收下，并报告真实类型", () => {
  assert.deepEqual(validateMediaMagicBytes(JPEG_HEADER, "image/png"), { ok: true, detected: "image/jpeg" });
  assert.deepEqual(validateMediaMagicBytes(JPEG_HEADER, "image/webp"), { ok: true, detected: "image/jpeg" });
  // 非图片内容冒充图片照旧拒绝
  assert.equal(validateMediaMagicBytes(new TextEncoder().encode("<svg onload=alert(1)>"), "image/png").ok, false);
  const ftyp = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  assert.equal(validateMediaMagicBytes(ftyp, "image/png").ok, false);
});

test("1025：上传路由按签名类型存储、命名与入库（不是按扩展名）", async () => {
  const seen: { key?: string; contentType?: string; mimeType?: string } = {};
  const handler = createUploadBlobPostHandler({
    requireAuth: async () => ({ ok: true, session: { user: { id: "user-1" } } as never }),
    getStorageProvider: () => ({
      id: "vercel_blob", displayName: "test", isConfigured: () => true,
      uploadFile: async (_bucket, _file, options) => {
        seen.key = options?.key;
        seen.contentType = options?.contentType;
        return { key: options?.key ?? "k", url: "https://assets.example.test/x", absolute: true };
      },
      uploadBuffer: async () => { throw new Error("unused"); },
      getSignedUploadUrl: async () => null, getSignedDownloadUrl: async () => "", getPublicUrl: () => "",
      deleteObject: async () => undefined,
    }),
    validateFileMagicBytes: async () => ({ ok: true, detected: "image/jpeg" }),
    assertQuotaForSession: async () => undefined,
    createOwnedMediaAsset: async (input) => {
      seen.mimeType = input.mimeType;
      return {
        id: "asset-1", userId: "user-1", workspaceId: null, storageKey: input.storageKey, url: input.url,
        mimeType: input.mimeType, byteSize: 12, sha256: "sha", width: 1, height: 1,
        createdAt: new Date(), updatedAt: new Date(),
      };
    },
    randomUUID: () => "fixed-random-id",
  });
  const form = new FormData();
  form.set("file", new File([JPEG_HEADER], "collar-cam.png", { type: "image/png" }));
  form.set("prefix", "uploads/references");
  const response = await handler(new Request("http://localhost/api/upload/blob", { method: "POST", body: form }) as never);
  assert.equal(response.status, 201);
  assert.equal(seen.contentType, "image/jpeg");
  assert.equal(seen.mimeType, "image/jpeg");
  assert.match(seen.key ?? "", /\.jpe?g$/);
});
