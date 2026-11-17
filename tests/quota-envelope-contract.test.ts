import assert from "node:assert/strict";
import test from "node:test";
import { quotaErrorResponse } from "../src/lib/api-quota";
import { customerApiErrorSchema } from "../src/lib/contracts/customer-api";
import {
  uploadBlobQuotaErrorSchema,
  uploadBlobResponseSchema,
} from "../src/lib/contracts/upload-blob";
import {
  QuotaExceededError,
} from "../src/lib/services/quota-service";

function baseEnvelope(value: Record<string, unknown>) {
  const metadata = new Set(["resource", "used", "limit", "periodKey"]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !metadata.has(key)),
  );
}

test("H1 quota contract: upload 429 uses a strict shared envelope plus explicit byte metadata", async () => {
  const response = quotaErrorResponse(
    new QuotaExceededError({
      resource: "BLOB_UPLOAD_BYTES",
      used: 1024,
      limit: 1024,
      periodKey: "2026-07",
    }),
  );
  assert.ok(response);
  assert.equal(response.status, 429);
  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(uploadBlobQuotaErrorSchema.parse(body), body);
  assert.deepEqual(uploadBlobResponseSchema.parse(body), body);
  assert.deepEqual(
    customerApiErrorSchema.parse(baseEnvelope(body)),
    baseEnvelope(body),
  );
  assert.equal(body.code, "QUOTA_EXCEEDED");
});

