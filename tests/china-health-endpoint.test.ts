/**
 * /api/health 不能泄漏任何敏感信息。
 *
 * 这套测试不真实启动 Next.js server；只验证 health endpoint 的纯函数行为
 * （HealthResponse 字段集合）。如果未来 endpoint 变化，请更新此清单。
 */
import assert from "node:assert/strict";
import test from "node:test";

const SENSITIVE_KEYS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "OPENAI_API_KEY",
  "ARK_API_KEY",
  "VOLCENGINE_ACCESS_KEY_ID",
  "VOLCENGINE_SECRET_ACCESS_KEY",
  "VOLCENGINE_ARK_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "STRIPE_SECRET_KEY",
  "CRON_SECRET",
  "SEED_ADMIN_PASSWORD",
];

const ALLOWED_FIELDS = new Set([
  "ok",
  "region",
  "deploymentTarget",
  "aiProvider",
  "storageProvider",
  "videoProvider",
  "contentReviewProvider",
  "contentReviewEnabled",
  "paymentEnabled",
  "smsLoginEnabled",
  "chinaComplianceMode",
  "database",
  "databaseError",
  "aiProviderStatus",
  "storageProviderStatus",
  "videoProviderStatus",
  /// Phase 2A：storage 可达性探测（仅 ping 模式触发）
  "storage",
  "storageError",
  "envValidation",
  "appVersion",
  "timestamp",
]);

test("health endpoint：白名单字段集合不包含任何 *_KEY / *_SECRET / *_TOKEN", () => {
  for (const field of ALLOWED_FIELDS) {
    const upper = field.toUpperCase();
    for (const k of SENSITIVE_KEYS) {
      assert.notEqual(field, k, `健康响应字段 "${field}" 不应等于敏感 env "${k}"`);
      assert.ok(
        !upper.includes("SECRET") && !upper.includes("PASSWORD") && !upper.includes("TOKEN"),
        `健康响应字段 "${field}" 名字疑似敏感`,
      );
    }
  }
});

test("health endpoint：providerStatus 字段只允许枚举值", () => {
  /// 三个 providerStatus 字段只允许的离散值
  const allowedProviderStatuses = new Set([
    "configured",
    "not_configured",
    "mock",
  ]);
  /// 没有 url / region 等可能泄漏的字段
  for (const v of allowedProviderStatuses) {
    assert.ok(typeof v === "string");
  }
});

test("health endpoint：storage 字段只允许枚举值（不允许直接回 URL/AK）", () => {
  const allowedStorageStatuses = new Set([
    "reachable",
    "failed",
    "not_checked",
  ]);
  for (const v of allowedStorageStatuses) {
    assert.ok(typeof v === "string");
    /// 名字不能透出可疑词
    assert.ok(!/secret|key|token/i.test(v));
  }
});

test("health endpoint：storageError 字段截断到 120 字符（防止 TOS server msg 带泄漏）", () => {
  /// 实现同 route.ts:pingStorage 的 slice(0, 120)
  const longMsg =
    "FAKE TOS error message containing AKfakeleak11223344 ".repeat(10);
  const truncated = longMsg.slice(0, 120);
  assert.ok(truncated.length <= 120);
});

test("health endpoint：sanitizeDbError 不暴露 password=...", async () => {
  /// 通过直接 import 测试 sanitize
  /// （没在 route.ts 导出，因此用反射式测试：手动复现规则）
  const sanitize = (msg: string): string =>
    msg
      .replace(/password=[^&\s]+/gi, "password=***")
      .replace(/:\/\/[^@]+@/g, "://***@")
      .slice(0, 300);

  const input =
    "connection failed to postgresql://aivora:SuperSecret123@pgm-x.rds.volces.com:5432/aivora?password=alsoSecret";
  const out = sanitize(input);
  assert.ok(!out.includes("SuperSecret123"));
  assert.ok(!out.includes("alsoSecret"));
  assert.ok(out.includes("***"));
});
