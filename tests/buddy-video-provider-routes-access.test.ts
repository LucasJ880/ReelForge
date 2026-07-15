import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { __test__ as apiAuthTest } from "../src/lib/api-auth";

const require = createRequire(import.meta.url);
type MutableRecord = Record<string, unknown>;
const nextAuthRuntime = require("next-auth/next") as MutableRecord;
const routeRuntime = require(
  "../src/app/api/internal/video-provider-routes/route.ts",
) as MutableRecord;

type TestSession = {
  user: {
    id: string;
    role: "SUPER_ADMIN" | "OPERATOR" | "CUSTOMER";
    userType: "SUPER_ADMIN" | "OPERATOR" | "BUSINESS";
  };
  expires: string;
};

let activeSession: TestSession | null = null;

function patch(
  t: TestContext,
  target: MutableRecord,
  values: MutableRecord,
): void {
  const originals: MutableRecord = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

test("video-provider route discovery is limited to SUPER_ADMIN and OPERATOR system roles", () => {
  for (const role of ["SUPER_ADMIN", "OPERATOR"] as const) {
    assert.equal(
      apiAuthTest.classifyAccess({
        role,
        userType: role,
        expecting: "operator",
      }),
      "allow",
    );
  }
  for (const role of ["REVIEWER", "CUSTOMER"] as const) {
    assert.equal(
      apiAuthTest.classifyAccess({
        role,
        userType: role === "CUSTOMER" ? "BUSINESS" : "OPERATOR",
        expecting: "operator",
      }),
      "deny-forbidden",
    );
  }
});

test("internal video-provider-routes route authenticates before read-only discovery", async () => {
  const source = await readFile(
    "src/app/api/internal/video-provider-routes/route.ts",
    "utf8",
  );
  const guardIndex = source.indexOf("await requireOperator()");
  const machineGuardIndex = source.indexOf("machineAuthFailure(req)");
  const discoveryIndex = source.indexOf("discoverBuddyModels()");
  const contractDiscoveryIndex = source.indexOf(
    "discoverBuddyApiContract()",
  );
  assert.ok(guardIndex >= 0, "route must use the system-role operator guard");
  assert.ok(machineGuardIndex >= 0, "route must support shared machine auth");
  assert.ok(
    discoveryIndex > guardIndex && discoveryIndex > machineGuardIndex,
    "both auth paths must complete before calling the upstream discovery client",
  );
  assert.ok(
    contractDiscoveryIndex > guardIndex,
    "route must authorize before probing official contract documents",
  );
  assert.doesNotMatch(source, /shuyu_api_key|Authorization|Bearer/);
  assert.doesNotMatch(
    source,
    /createVideoJob|submitSeedance|contents\/generations\/tasks/,
  );
  assert.match(
    source,
    /models_and_openapi_read_only_non_billing|buddyVideoProviderRoute/,
  );
  assert.match(source, /Cache-Control/);
  assert.match(source, /private, no-store/);
});

test("video-provider-routes accepts staff session or valid machine auth and denies all other callers before fetch", async (t) => {
  patch(t, nextAuthRuntime, {
    getServerSession: async () => activeSession,
  });

  const previousCronSecret = process.env.CRON_SECRET;
  const previousBuddyKey = process.env.shuyu_api_key;
  process.env.CRON_SECRET = "test-only-machine-secret";
  process.env.shuyu_api_key = "test-only-buddy-discovery-secret";
  t.after(() => {
    if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCronSecret;
    if (previousBuddyKey === undefined) delete process.env.shuyu_api_key;
    else process.env.shuyu_api_key = previousBuddyKey;
  });

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    fetchCalls += 1;
    const url = String(input);
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ models: ["seedance-test"] }), {
        status: 200,
      });
    }
    if (url.endsWith("/openapi.json")) {
      return new Response(
        JSON.stringify({
          openapi: "3.0.3",
          paths: {
            "/video/tasks": {
              post: {
                operationId: "createVideoTask",
                tags: ["video"],
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: { model: {}, prompt: {} },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const get = routeRuntime.GET as (request: NextRequest) => Promise<Response>;
  const request = (authorization?: string) =>
    new NextRequest("http://localhost/api/internal/video-provider-routes", {
      headers: authorization ? { authorization } : undefined,
    });

  activeSession = {
    user: {
      id: "operator-test",
      role: "OPERATOR",
      userType: "OPERATOR",
    },
    expires: "2099-01-01T00:00:00.000Z",
  };
  fetchCalls = 0;
  const operatorResponse = await get(request());
  assert.equal(operatorResponse.status, 200);
  assert.equal(fetchCalls, 2);

  activeSession = null;
  fetchCalls = 0;
  const machineResponse = await get(
    request("Bearer test-only-machine-secret"),
  );
  assert.equal(machineResponse.status, 200);
  assert.equal(fetchCalls, 2);
  assert.doesNotMatch(
    await machineResponse.text(),
    /test-only-machine-secret|test-only-buddy-discovery-secret/,
  );

  fetchCalls = 0;
  const invalidMachine = await get(request("Bearer wrong-secret"));
  assert.equal(invalidMachine.status, 401);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(await invalidMachine.json(), { error: "unauthorized" });

  fetchCalls = 0;
  const unauthenticated = await get(request());
  assert.equal(unauthenticated.status, 401);
  assert.equal(fetchCalls, 0);

  activeSession = {
    user: {
      id: "customer-test",
      role: "CUSTOMER",
      userType: "BUSINESS",
    },
    expires: "2099-01-01T00:00:00.000Z",
  };
  fetchCalls = 0;
  const customerResponse = await get(request());
  assert.equal(customerResponse.status, 403);
  assert.equal(fetchCalls, 0);
});
