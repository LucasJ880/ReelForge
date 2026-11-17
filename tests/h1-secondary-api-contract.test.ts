import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { __test__ as apiAuthTest } from "../src/lib/api-auth";
import {
  customerApiError,
  customerApiErrorSchema,
} from "../src/lib/contracts/customer-api";

/**
 * 这份文件原来锁「二线接口」的逐路由契约清单：2026-10-28 旧中台删除后只剩投放赛马的三条，
 * 2026-11-16 投放赛马（/api/racing/**）也删了，清单随之清空。留下的是和具体路由无关的那一条：
 * 守卫的分级与统一的错误包。
 */

test("H1 secondary auth: operator and super-admin routes fail closed for anonymous/customer roles", async () => {
  assert.equal(
    apiAuthTest.classifyAccess({
      role: null,
      userType: null,
      expecting: "operator",
    }),
    "deny-not-logged-in",
  );
  assert.equal(
    apiAuthTest.classifyAccess({
      role: "CUSTOMER",
      userType: "BUSINESS",
      expecting: "operator",
    }),
    "deny-forbidden",
  );
  assert.equal(
    apiAuthTest.classifyAccess({
      role: "OPERATOR",
      userType: "OPERATOR",
      expecting: "operator",
    }),
    "allow",
  );

  const authSource = await readFile("src/lib/api-auth.ts", "utf8");
  assert.match(
    authSource,
    /function requireSuperAdmin\(\)[\s\S]*?requireRole\(\["SUPER_ADMIN"\]\)/,
  );
  assert.match(
    authSource,
    /function requireBusinessUser\(\)[\s\S]*?requireUserOfPersona\(\["BUSINESS"\]\)/,
  );
  assert.deepEqual(
    customerApiErrorSchema.parse(
      customerApiError({
        code: "AUTH_REQUIRED",
        message: "未登录",
        retryable: false,
        action: "sign_in",
      }),
    ),
    {
      ok: false,
      code: "AUTH_REQUIRED",
      error: "未登录",
      retryable: false,
      action: "sign_in",
    },
  );
  assert.deepEqual(
    customerApiErrorSchema.parse(
      customerApiError({
        code: "FORBIDDEN",
        message: "权限不足",
        retryable: false,
        action: "contact_support",
      }),
    ),
    {
      ok: false,
      code: "FORBIDDEN",
      error: "权限不足",
      retryable: false,
      action: "contact_support",
    },
  );
});
