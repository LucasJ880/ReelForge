import assert from "node:assert/strict";
import test from "node:test";
import {
  detectMediaMime,
  validateMediaMagicBytes,
} from "../src/lib/upload/media-file-validation";
import { DEFAULT_IMAGE_MODEL, generateImages } from "../src/lib/providers/openai-image";

test("legacy direct image provider remains mockable for historical non-public callers", async () => {
  assert.equal(DEFAULT_IMAGE_MODEL, "gpt-image-2");
  const result = await generateImages({
    prompt: "a faithful product photo",
    n: 1,
    forceMock: true,
  });
  assert.equal(result.fromMock, true);
  assert.equal(result.modelUsed, "mock");
  assert.equal(result.usage, null);
  assert.match(result.urls[0], /^\/template-previews\//);
});

test("magic-byte validation accepts supported real signatures and rejects spoofed images", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectMediaMime(png), "image/png");
  assert.deepEqual(validateMediaMagicBytes(png, "image/png"), {
    ok: true,
    detected: "image/png",
  });
  const spoof = new TextEncoder().encode("<script>alert(1)</script>");
  assert.equal(validateMediaMagicBytes(spoof, "image/png").ok, false);
});

test("shared upload validator accepts ISO media container for MP4 video and M4A audio", () => {
  const ftyp = Uint8Array.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
  ]);
  assert.equal(validateMediaMagicBytes(ftyp, "video/mp4").ok, true);
  assert.equal(validateMediaMagicBytes(ftyp, "audio/x-m4a").ok, true);
  assert.equal(validateMediaMagicBytes(ftyp, "image/png").ok, false);
});
