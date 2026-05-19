import assert from "node:assert/strict";
import test from "node:test";
import { QUOTA_LIMITS } from "../src/lib/config/quota-tiers";
import { __test__ } from "../src/lib/services/quota-service";

test("currentUsagePeriodKey 使用 UTC 自然月", () => {
  const key = __test__.currentUsagePeriodKey(new Date("2026-05-19T12:00:00Z"));
  assert.equal(key, "2026-05");
});

test("内部 staff session 豁免配额", () => {
  assert.equal(
    __test__.isQuotaExemptSession({
      user: {
        id: "u1",
        email: "ops@aivora.internal",
        role: "OPERATOR",
        userType: "SUPER_ADMIN",
      },
      expires: "",
    }),
    true,
  );
  assert.equal(
    __test__.isQuotaExemptSession({
      user: {
        id: "u2",
        email: "user@example.com",
        role: "OPERATOR",
        userType: "PERSONAL",
      },
      expires: "",
    }),
    false,
  );
});

test("免费档限额包含四类资源", () => {
  assert.ok(QUOTA_LIMITS.free.VIDEO_DISPATCH >= 1);
  assert.ok(QUOTA_LIMITS.free.PLAN_PREVIEW >= 1);
  assert.ok(QUOTA_LIMITS.free.BLOB_UPLOAD_BYTES >= 1024 * 1024);
  assert.ok(QUOTA_LIMITS.free.SEEDANCE_SEGMENT >= 1);
});
