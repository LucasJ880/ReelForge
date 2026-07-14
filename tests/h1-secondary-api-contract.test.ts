import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { z } from "zod";
import { __test__ as apiAuthTest } from "../src/lib/api-auth";
import {
  customerApiError,
  customerApiErrorSchema,
} from "../src/lib/contracts/customer-api";
import { db } from "../src/lib/db";
import { importBusinessVideoMetrics } from "../src/lib/services/business-metrics-import";
import {
  assertRacingRoundAccess,
  isInternalRacingUser,
} from "../src/lib/services/racing-service";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type GuardName =
  | "requireSuperAdmin"
  | "requireOperator"
  | "requireBusinessUser"
  | "requireAuth";
type SuccessKind =
  | "items"
  | "entity"
  | "ok"
  | "list"
  | "record"
  | "entity-or-items"
  | "record-or-results"
  | "business-metrics"
  | "racing-analysis"
  | "racing-metrics"
  | "racing-next"
  | "csv";

interface RouteContract {
  file: string;
  method: HttpMethod;
  guard: GuardName;
  successKind: SuccessKind;
  successPatterns: RegExp[];
  ownership?: "business" | "racing";
}

const ROUTES: RouteContract[] = [
  {
    file: "src/app/api/admin/users/route.ts",
    method: "GET",
    guard: "requireSuperAdmin",
    successKind: "items",
    successPatterns: [/NextResponse\.json\(\{\s*items:\s*users\s*\}\)/],
  },
  {
    file: "src/app/api/admin/users/route.ts",
    method: "POST",
    guard: "requireSuperAdmin",
    successKind: "entity",
    successPatterns: [
      /NextResponse\.json\(user,\s*\{\s*status:\s*201\s*\}\)/,
    ],
  },
  {
    file: "src/app/api/admin/users/[id]/route.ts",
    method: "PATCH",
    guard: "requireSuperAdmin",
    successKind: "entity",
    successPatterns: [/NextResponse\.json\(user\)/],
  },
  {
    file: "src/app/api/admin/users/[id]/route.ts",
    method: "DELETE",
    guard: "requireSuperAdmin",
    successKind: "ok",
    successPatterns: [/NextResponse\.json\(\{\s*ok:\s*true\s*\}\)/],
  },
  {
    file: "src/app/api/delivery-orders/route.ts",
    method: "GET",
    guard: "requireOperator",
    successKind: "list",
    successPatterns: [/NextResponse\.json\(result\)/],
  },
  {
    file: "src/app/api/delivery-orders/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "entity",
    successPatterns: [
      /NextResponse\.json\(order,\s*\{\s*status:\s*201\s*\}\)/,
    ],
  },
  {
    file: "src/app/api/delivery-orders/[id]/route.ts",
    method: "GET",
    guard: "requireOperator",
    successKind: "entity",
    successPatterns: [/NextResponse\.json\(order\)/],
  },
  {
    file: "src/app/api/delivery-orders/[id]/route.ts",
    method: "PATCH",
    guard: "requireOperator",
    successKind: "entity",
    successPatterns: [/NextResponse\.json\(updated\)/],
  },
  {
    file: "src/app/api/delivery-orders/[id]/assets/route.ts",
    method: "GET",
    guard: "requireOperator",
    successKind: "items",
    successPatterns: [/NextResponse\.json\(\{\s*items\s*\}\)/],
  },
  {
    file: "src/app/api/delivery-orders/[id]/assets/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "entity-or-items",
    successPatterns: [
      /NextResponse\.json\(\{\s*items\s*\}\)/,
      /NextResponse\.json\(asset\)/,
    ],
  },
  {
    file: "src/app/api/delivery-orders/[id]/research/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "ok",
    successPatterns: [/NextResponse\.json\(\{\s*ok:\s*true\s*\}\)/],
  },
  {
    file: "src/app/api/delivery-orders/[id]/rounds/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "entity",
    successPatterns: [
      /NextResponse\.json\(round,\s*\{\s*status:\s*201\s*\}\)/,
    ],
  },
  {
    file: "src/app/api/delivery-orders/[id]/selling-points/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "items",
    successPatterns: [/NextResponse\.json\(\{\s*items:\s*points\s*\}\)/],
  },
  {
    file: "src/app/api/rounds/[id]/route.ts",
    method: "GET",
    guard: "requireOperator",
    successKind: "entity",
    successPatterns: [/NextResponse\.json\(round\)/],
  },
  {
    file: "src/app/api/rounds/[id]/ad-plans/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "items",
    successPatterns: [/NextResponse\.json\(\{\s*items\s*\}\)/],
  },
  {
    file: "src/app/api/rounds/[id]/angles/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "items",
    successPatterns: [/NextResponse\.json\(\{\s*items:\s*angles\s*\}\)/],
  },
  {
    file: "src/app/api/rounds/[id]/distill/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "record",
    successPatterns: [/NextResponse\.json\(distillation\)/],
  },
  {
    file: "src/app/api/rounds/[id]/iteration/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "record",
    successPatterns: [/NextResponse\.json\(report\)/],
  },
  {
    file: "src/app/api/rounds/[id]/score/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "record",
    successPatterns: [/NextResponse\.json\(result\)/],
  },
  {
    file: "src/app/api/metrics/import/route.ts",
    method: "GET",
    guard: "requireOperator",
    successKind: "csv",
    successPatterns: [
      /new NextResponse\(METRICS_CSV_TEMPLATE,\s*\{[\s\S]*?text\/csv/,
    ],
  },
  {
    file: "src/app/api/metrics/import/route.ts",
    method: "POST",
    guard: "requireOperator",
    successKind: "record-or-results",
    successPatterns: [
      /NextResponse\.json\(\{\s*results\s*\}\)/,
      /NextResponse\.json\(snap\)/,
    ],
  },
  {
    file: "src/app/api/business/metrics/route.ts",
    method: "POST",
    guard: "requireBusinessUser",
    successKind: "business-metrics",
    successPatterns: [
      /NextResponse\.json\(\{\s*ok:\s*true,\s*snapshot:\s*snap\s*\}\)/,
    ],
    ownership: "business",
  },
  {
    file: "src/app/api/racing/rounds/[id]/analyze/route.ts",
    method: "POST",
    guard: "requireAuth",
    successKind: "racing-analysis",
    successPatterns: [
      /NextResponse\.json\(\{\s*ok:\s*true,\s*report\s*\}\)/,
    ],
    ownership: "racing",
  },
  {
    file: "src/app/api/racing/rounds/[id]/metrics/route.ts",
    method: "POST",
    guard: "requireAuth",
    successKind: "racing-metrics",
    successPatterns: [
      /NextResponse\.json\(\{\s*ok:\s*true,\s*\.\.\.result\s*\}\)/,
    ],
    ownership: "racing",
  },
  {
    file: "src/app/api/racing/rounds/[id]/next/route.ts",
    method: "POST",
    guard: "requireAuth",
    successKind: "racing-next",
    successPatterns: [
      /NextResponse\.json\(\{\s*ok:\s*true,\s*round\s*\}\)/,
    ],
    ownership: "racing",
  },
];

const recordSchema = z.record(z.unknown()).refine(
  (value) => Object.keys(value).length > 0,
  "success record cannot be empty",
);
const entitySchema = z.object({ id: z.string().min(1) }).passthrough();
const itemsSchema = z.object({ items: z.array(z.unknown()) }).strict();
const successSchemas: Record<SuccessKind, z.ZodTypeAny> = {
  items: itemsSchema,
  entity: entitySchema,
  ok: z.object({ ok: z.literal(true) }).strict(),
  list: z
    .object({ items: z.array(z.unknown()), total: z.number().int().nonnegative() })
    .strict(),
  record: recordSchema,
  "entity-or-items": z.union([entitySchema, itemsSchema]),
  "record-or-results": z.union([
    recordSchema,
    z.object({ results: z.array(z.unknown()) }).strict(),
  ]),
  "business-metrics": z
    .object({ ok: z.literal(true), snapshot: recordSchema })
    .strict(),
  "racing-analysis": z
    .object({ ok: z.literal(true), report: recordSchema })
    .strict(),
  "racing-metrics": z
    .object({
      ok: z.literal(true),
      placement: recordSchema,
      snapshot: recordSchema,
    })
    .strict(),
  "racing-next": z
    .object({ ok: z.literal(true), round: recordSchema })
    .strict(),
  csv: z
    .string()
    .startsWith("external_post_id,window_hours,views,completion_rate"),
};

const successFixtures: Record<SuccessKind, unknown> = {
  items: { items: [] },
  entity: { id: "entity-contract" },
  ok: { ok: true },
  list: { items: [], total: 0 },
  record: { id: "record-contract" },
  "entity-or-items": { id: "asset-contract" },
  "record-or-results": { results: [] },
  "business-metrics": {
    ok: true,
    snapshot: { id: "snapshot-contract" },
  },
  "racing-analysis": { ok: true, report: { id: "report-contract" } },
  "racing-metrics": {
    ok: true,
    placement: { id: "placement-contract" },
    snapshot: { id: "snapshot-contract" },
  },
  "racing-next": { ok: true, round: { id: "round-contract" } },
  csv: "external_post_id,window_hours,views,completion_rate\n",
};

function routeKey(route: Pick<RouteContract, "file" | "method">): string {
  return `${route.file}#${route.method}`;
}

function methodBlock(source: string, method: HttpMethod): string {
  const marker = `export async function ${method}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${method} export`);
  const remainder = source.slice(start + marker.length);
  const next = remainder.search(/\nexport async function (?:GET|POST|PATCH|DELETE)\b/);
  return source.slice(start, next === -1 ? source.length : start + marker.length + next);
}

function patch(
  t: TestContext,
  target: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

test("H1 secondary contracts: the declared route-method inventory is complete", async () => {
  const files = [...new Set(ROUTES.map((route) => route.file))];
  const actual: string[] = [];
  for (const file of files) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    for (const match of source.matchAll(
      /export async function (GET|POST|PATCH|DELETE)\b/g,
    )) {
      actual.push(`${file}#${match[1]}`);
    }
  }
  assert.deepEqual(
    actual.sort(),
    ROUTES.map(routeKey).sort(),
    "every second-tier route method must have an explicit contract row",
  );
  assert.equal(ROUTES.length, 25);
});

test("H1 secondary contracts: every method guards before work and locks its success wire shape", async () => {
  for (const route of ROUTES) {
    const source = await readFile(path.join(process.cwd(), route.file), "utf8");
    const block = methodBlock(source, route.method);
    const guardPattern = new RegExp(
      `const\\s+guard\\s*=\\s*await\\s+${route.guard}\\(\\);[\\s\\S]*?if\\s*\\(!guard\\.ok\\)\\s*return\\s+guard\\.response`,
    );
    assert.match(block, guardPattern, `${routeKey(route)} auth boundary`);
    for (const pattern of route.successPatterns) {
      assert.match(block, pattern, `${routeKey(route)} success contract`);
    }
    const guardIndex = block.search(new RegExp(`await\\s+${route.guard}\\(`));
    const firstSuccessIndex = Math.min(
      ...route.successPatterns.map((pattern) => block.search(pattern)),
    );
    assert.ok(
      guardIndex >= 0 && firstSuccessIndex > guardIndex,
      `${routeKey(route)} must authorize before emitting success`,
    );
    assert.doesNotMatch(
      block,
      /getVideoProvider|createVideoJob|submitClaimedJob|fetch\(\s*["']https?:/,
      `${routeKey(route)} contract test surface must not invoke a provider/network`,
    );
  }
});

test("H1 secondary contracts: every success family has an explicit lightweight DTO schema", () => {
  const kinds = [...new Set(ROUTES.map((route) => route.successKind))];
  for (const kind of kinds) {
    assert.deepEqual(
      successSchemas[kind].parse(successFixtures[kind]),
      successFixtures[kind],
      `${kind} success fixture`,
    );
  }
});

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

test("H1 secondary ownership: racing routes scope customers to their own delivery orders", async (t) => {
  const seen: unknown[] = [];
  patch(t, db.round as unknown as Record<string, unknown>, {
    findFirst: async (args: unknown) => {
      seen.push(args);
      return null;
    },
  });

  await assert.rejects(
    () =>
      assertRacingRoundAccess("round-other-owner", {
        userId: "customer-1",
        canViewAll: false,
      }),
    /找不到该赛马轮次或无权访问/,
  );
  assert.deepEqual(seen, [
    {
      where: {
        id: "round-other-owner",
        deliveryOrder: { createdById: "customer-1" },
      },
      select: { id: true, deliveryOrderId: true },
    },
  ]);
  assert.equal(isInternalRacingUser("BUSINESS"), false);
  assert.equal(isInternalRacingUser("PERSONAL"), false);
  assert.equal(isInternalRacingUser("OPERATOR"), true);
  assert.equal(isInternalRacingUser("SUPER_ADMIN"), true);
});

test("H1 secondary ownership: business metric import is owner- and persona-scoped before mutation", async (t) => {
  let seenWhere: unknown = null;
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findFirst: async (args: { where: unknown }) => {
      seenWhere = args.where;
      return null;
    },
  });

  await assert.rejects(
    () =>
      importBusinessVideoMetrics({
        userId: "business-owner",
        briefId: "foreign-brief",
        windowHours: 24,
        metrics: { views: 10 },
      }),
    /找不到该视频或无权录入数据/,
  );
  assert.deepEqual(seenWhere, {
    id: "foreign-brief",
    persona: { not: "PERSONAL" },
    contentAngle: {
      round: { deliveryOrder: { createdById: "business-owner" } },
    },
  });
});
