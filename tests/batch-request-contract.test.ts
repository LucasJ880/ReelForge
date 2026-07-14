import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BATCH_VIDEO_COUNT,
} from "../src/lib/contracts/batch-limits";
import { batchCreateRequestSchema } from "../src/lib/contracts/batch-request";

function request(requestedCount: number) {
  return {
    templateId: "template-1",
    templateVersion: 1,
    images: [{ id: "image-1", url: "https://example.com/image.png" }],
    requestedCount,
  };
}

test("RF-020: the commercial 250-item tier is accepted by the API contract", () => {
  assert.equal(MAX_BATCH_VIDEO_COUNT, 250);
  assert.equal(batchCreateRequestSchema.safeParse(request(250)).success, true);
});

test("RF-020: 251 items remain fail-closed", () => {
  const parsed = batchCreateRequestSchema.safeParse(request(251));
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.deepEqual(parsed.error.issues.map((issue) => issue.path), [
      ["requestedCount"],
    ]);
  }
});
