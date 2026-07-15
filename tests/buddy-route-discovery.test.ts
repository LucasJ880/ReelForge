import assert from "node:assert/strict";
import test from "node:test";
import {
  internalVideoProviderRoutesResponseSchema,
} from "../src/lib/contracts/video-provider-routes";
import {
  BUDDY_API_BASE_URL,
  BUDDY_OPENAPI_PATHS,
  buddyVideoProviderRoute,
  discoverBuddyApiContract,
  discoverBuddyModels,
  sanitizeBuddyOpenApiPayload,
  sanitizeBuddyModelsPayload,
} from "../src/lib/server/buddy-route-discovery";

test("Buddy discovery uses only the fixed non-billing GET /models route", async () => {
  const secret = "test-only-buddy-secret-never-return";
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const fetchStub: typeof fetch = async (input, init) => {
    calledUrl = String(input);
    calledInit = init;
    return new Response(
      JSON.stringify({
        data: {
          models: [
            {
              id: "seedance-test-model",
              display_name: "Seedance Test Model",
              version: "v2",
              status: "ACTIVE",
              capabilities: ["video_generation", "image_to_video"],
              api_key: secret,
              raw_response: { authorization: `Bearer ${secret}` },
              price: "must-not-be-trusted",
            },
          ],
        },
        token: secret,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const discovery = await discoverBuddyModels({
    fetchImpl: fetchStub,
    env: { shuyu_api_key: secret },
  });

  assert.equal(calledUrl, `${BUDDY_API_BASE_URL}/models`);
  assert.equal(calledInit?.method, "GET");
  assert.equal(calledInit?.cache, "no-store");
  assert.equal(calledInit?.redirect, "error");
  assert.ok(calledInit?.signal);
  assert.equal(
    new Headers(calledInit?.headers).get("authorization"),
    `Bearer ${secret}`,
  );
  assert.equal(discovery.available, true);
  if (!discovery.available) assert.fail("expected available Buddy discovery");
  assert.deepEqual(discovery.models, [
    {
      id: "seedance-test-model",
      name: "Seedance Test Model",
      version: "v2",
      status: "active",
      capabilities: ["video_generation", "image_to_video"],
    },
  ]);

  const contract = await discoverBuddyApiContract({ env: {} });
  const response = internalVideoProviderRoutesResponseSchema.parse({
    ok: true,
    routes: [buddyVideoProviderRoute(discovery, contract)],
  });
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /api_key|authorization|raw_response|price/i);
  assert.deepEqual(Object.keys(response.routes[0]).sort(), [
    "apiBaseUrl",
    "availability",
    "contract",
    "discoveryMode",
    "displayName",
    "id",
    "models",
    "provider",
    "unavailableReason",
  ]);
  assert.deepEqual(Object.keys(response.routes[0].models[0]).sort(), [
    "capabilities",
    "id",
    "name",
    "status",
    "version",
  ]);
  assert.deepEqual(response.routes[0].contract, {
    availability: "unavailable",
    sourcePath: null,
    unavailableReason: "not_configured",
    submitPath: null,
    statusPath: null,
    cancelPath: null,
    operations: [],
  });
});

test("Buddy OpenAPI sanitizer extracts only bounded video adapter fields", () => {
  const secret = "test-openapi-secret-never-return";
  const contract = sanitizeBuddyOpenApiPayload(
    {
      openapi: "3.1.0",
      info: { title: secret, description: `token=${secret}` },
      servers: [{ url: `https://${secret}.example` }],
      paths: {
        "/videos/tasks": {
          post: {
            operationId: "createVideoTask",
            tags: ["video"],
            description: `Authorization: Bearer ${secret}`,
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreateVideoTask" },
                  example: { api_key: secret },
                },
              },
            },
          },
        },
        "/videos/tasks/{task_id}": {
          parameters: [
            { name: "task_id", in: "path", required: true },
            { name: "api_key", in: "query" },
          ],
          get: {
            operationId: "getVideoTask",
            tags: ["video"],
          },
          delete: {
            operationId: "cancelVideoTask",
            tags: ["video"],
          },
        },
        "/billing/invoices": {
          get: { operationId: "listInvoices", tags: ["billing"] },
        },
      },
      components: {
        schemas: {
          CreateVideoTask: {
            type: "object",
            properties: {
              model: { type: "string" },
              prompt: { type: "string" },
              image_url: { type: "string" },
              api_key: { type: "string", default: secret },
              bearer_token: { type: "string", example: secret },
            },
          },
        },
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer", description: secret },
        },
      },
    },
    "/openapi.json",
  );

  assert.ok(contract);
  assert.equal(contract.availability, "available");
  assert.equal(contract.submitPath, "/videos/tasks");
  assert.equal(contract.statusPath, "/videos/tasks/{task_id}");
  assert.equal(contract.cancelPath, "/videos/tasks/{task_id}");
  assert.equal(contract.operations.length, 3);
  const submit = contract.operations.find(
    (operation) => operation.method === "POST",
  );
  assert.deepEqual(submit?.requestFields, ["image_url", "model", "prompt"]);
  const status = contract.operations.find(
    (operation) => operation.method === "GET",
  );
  assert.deepEqual(status?.pathParameters, ["task_id"]);
  assert.deepEqual(status?.queryParameters, []);
  const serialized = JSON.stringify(contract);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(
    serialized,
    /api_key|authorization|bearer_token|securitySchemes|example|description/i,
  );
  assert.doesNotMatch(serialized, /billing\/invoices/);
});

test("Buddy contract discovery only GETs fixed OpenAPI candidates and sanitizes the result", async () => {
  const secret = "configured-contract-test-key";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const discovery = await discoverBuddyApiContract({
    env: { shuyu_api_key: secret },
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === `${BUDDY_API_BASE_URL}${BUDDY_OPENAPI_PATHS[0]}`) {
        return new Response("not found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          openapi: "3.0.3",
          paths: {
            "/contents/generations/tasks": {
              post: {
                operationId: "createVideoTask",
                tags: ["video"],
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: { model: {}, content: {} },
                      },
                    },
                  },
                },
              },
            },
            "/contents/generations/tasks/{id}": {
              get: {
                operationId: "getVideoTask",
                tags: ["video"],
                parameters: [{ name: "id", in: "path" }],
              },
            },
          },
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(discovery.availability, "available");
  assert.equal(discovery.sourcePath, "/docs/openapi.json");
  assert.deepEqual(
    calls.map((call) => call.url),
    BUDDY_OPENAPI_PATHS.map((path) => `${BUDDY_API_BASE_URL}${path}`),
  );
  for (const call of calls) {
    assert.equal(call.init?.method, "GET");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.redirect, "error");
    assert.equal(
      new Headers(call.init?.headers).get("authorization"),
      `Bearer ${secret}`,
    );
  }
});

test("Buddy contract discovery reports unavailable without inventing a contract", async () => {
  let missingSecretCalls = 0;
  const missingSecret = await discoverBuddyApiContract({
    env: {},
    fetchImpl: async () => {
      missingSecretCalls += 1;
      throw new Error("must not fetch");
    },
  });
  assert.equal(missingSecretCalls, 0);
  assert.deepEqual(missingSecret, {
    availability: "unavailable",
    sourcePath: null,
    unavailableReason: "not_configured",
    submitPath: null,
    statusPath: null,
    cancelPath: null,
    operations: [],
  });

  const notFound = await discoverBuddyApiContract({
    env: { shuyu_api_key: "configured-test-key" },
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });
  assert.equal(notFound.availability, "unavailable");
  assert.equal(notFound.unavailableReason, "not_found");
  assert.equal(notFound.sourcePath, null);
  assert.deepEqual(notFound.operations, []);

  const noVideo = await discoverBuddyApiContract({
    env: { shuyu_api_key: "configured-test-key" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          openapi: "3.0.0",
          paths: {
            "/health": { get: { operationId: "health" } },
          },
        }),
        { status: 200 },
      ),
  });
  assert.equal(noVideo.availability, "unavailable");
  assert.equal(noVideo.unavailableReason, "video_contract_unavailable");
  assert.equal(noVideo.sourcePath, "/openapi.json");
  assert.equal(noVideo.submitPath, null);
  assert.equal(noVideo.statusPath, null);
});

test("Buddy model sanitizer accepts bounded common payload shapes and drops unknown items", () => {
  assert.deepEqual(
    sanitizeBuddyModelsPayload({
      models: [
        "plain-model-id",
        { model_id: "model-two", name: "Model Two", unknown: "drop-me" },
        { modelId: "model-three", displayName: "Model Three" },
        { model: "model-four", status: "preview" },
        { id: "model-two", name: "duplicate is ignored" },
        { id: "spaces are not an identifier" },
        { name: "Display name without a safe id" },
        42,
      ],
    }),
    [
      {
        id: "plain-model-id",
        name: null,
        version: null,
        status: null,
        capabilities: [],
      },
      {
        id: "model-two",
        name: "Model Two",
        version: null,
        status: null,
        capabilities: [],
      },
      {
        id: "model-three",
        name: "Model Three",
        version: null,
        status: null,
        capabilities: [],
      },
      {
        id: "model-four",
        name: null,
        version: null,
        status: "preview",
        capabilities: [],
      },
    ],
  );
  assert.deepEqual(sanitizeBuddyModelsPayload({ items: [] }), []);
  assert.equal(sanitizeBuddyModelsPayload({ unexpected: [] }), null);
});

test("Buddy discovery fails closed with sanitized unavailable reasons", async () => {
  let called = false;
  const shouldNotFetch: typeof fetch = async () => {
    called = true;
    throw new Error("unexpected fetch");
  };
  const missing = await discoverBuddyModels({
    fetchImpl: shouldNotFetch,
    env: {},
  });
  assert.equal(called, false);
  assert.deepEqual(missing, {
    available: false,
    reason: "not_configured",
    models: [],
  });

  const secret = "upstream-secret-must-not-leak";
  const rejected = await discoverBuddyModels({
    env: { shuyu_api_key: "configured-test-key" },
    fetchImpl: async () =>
      new Response(`provider rejected token=${secret}`, { status: 401 }),
  });
  assert.deepEqual(rejected, {
    available: false,
    reason: "authentication_rejected",
    models: [],
  });
  assert.doesNotMatch(JSON.stringify(rejected), new RegExp(secret));

  const timedOut = await discoverBuddyModels({
    env: { shuyu_api_key: "configured-test-key" },
    fetchImpl: async () => {
      const error = new Error(`AbortError ${secret}`);
      error.name = "AbortError";
      throw error;
    },
  });
  assert.deepEqual(timedOut, {
    available: false,
    reason: "timeout",
    models: [],
  });

  const invalid = await discoverBuddyModels({
    env: { shuyu_api_key: "configured-test-key" },
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  assert.deepEqual(invalid, {
    available: false,
    reason: "invalid_response",
    models: [],
  });
});

test("Buddy model discovery distinguishes bounded non-secret HTTP failures", async () => {
  for (const [status, reason] of [
    [401, "authentication_rejected"],
    [403, "authentication_rejected"],
    [404, "models_endpoint_unavailable"],
    [405, "models_endpoint_unavailable"],
    [429, "rate_limited"],
    [502, "upstream_unavailable"],
  ] as const) {
    const discovery = await discoverBuddyModels({
      env: { shuyu_api_key: "configured-test-key" },
      fetchImpl: async () => new Response("", { status }),
    });
    assert.deepEqual(discovery, { available: false, reason, models: [] });
  }
});
