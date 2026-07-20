import assert from "node:assert/strict";
import test from "node:test";
import { internalVideoProviderRoutesResponseSchema } from "../src/lib/contracts/video-provider-routes";
import {
  SHUYU_API_BASE_URL,
  getShuyuPrices,
} from "../src/lib/providers/shuyu";
import { discoverShuyuVideoRoute } from "../src/lib/server/buddy-route-discovery";

const videoPlan = {
  plan_id: "video-plan-02",
  kind: "video",
  model: "studio-video",
  unit: "generation",
  resolution: "720P",
  sale_points: 900,
  display_name: "Seedance 2.0 · 720P",
  capabilities: {
    aspect_ratios: ["9:16", "16:9", "1:1"],
    input_images_max: 9,
    modes: ["frames2video", "image2video", "text2video"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    quality: "720P",
  },
  status: "available",
};

const healthPayload = {
  object: "service_health",
  status: "operational",
  capabilities: { image: "available", video: "available" },
  checked_at: "2026-07-19T02:00:00.000Z",
};

test("Shuyu discovery only uses documented read-only health, prices and balance routes", async () => {
  const secret = "test-only-shuyu-secret-never-return";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify(healthPayload), { status: 200 });
    }
    if (url.endsWith("/prices")) {
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              ...videoPlan,
              api_key: secret,
              raw_response: { authorization: `Bearer ${secret}` },
            },
          ],
          token: secret,
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        object: "balance",
        available_points: 0,
        unit: "points",
        token: secret,
      }),
      { status: 200 },
    );
  };

  const discovered = await discoverShuyuVideoRoute({
    fetchImpl: fetchStub,
    env: { shuyu_api_key: secret },
  });

  assert.deepEqual(
    calls.map((call) => call.url).sort(),
    [
      `${SHUYU_API_BASE_URL}/account/balance`,
      `${SHUYU_API_BASE_URL}/health`,
      `${SHUYU_API_BASE_URL}/prices`,
    ],
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

  const response = internalVideoProviderRoutesResponseSchema.parse({
    ok: true,
    routes: [discovered],
  });
  assert.equal(response.routes[0].configured, true);
  assert.equal(response.routes[0].funded, false);
  assert.equal(response.routes[0].availability, "unavailable");
  assert.equal(response.routes[0].unavailableReason, "insufficient_balance");
  assert.deepEqual(response.routes[0].plans, [
    {
      planId: "video-plan-02",
      kind: "video",
      model: "studio-video",
      unit: "generation",
      resolution: "720P",
      salePoints: 900,
    },
  ]);
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /available_points|api_key|authorization/i);
});

test("prices parser strips unknown fields and keeps the exact documented plan shape", async () => {
  const prices = await getShuyuPrices({
    env: { SHUYU_API_KEY: "canonical-test-key" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [{ ...videoPlan, secret: "must-not-cross" }],
          arbitrary: "ignored",
        }),
        { status: 200 },
      ),
  });
  assert.deepEqual(prices, { object: "list", data: [videoPlan] });
});

test("discovery stays available when audited plan is among additional video plans", async () => {
  const discovered = await discoverShuyuVideoRoute({
    env: { SHUYU_API_KEY: "configured" },
    fetchImpl: async (input) =>
      String(input).endsWith("/health")
        ? new Response(JSON.stringify(healthPayload), { status: 200 })
        : String(input).endsWith("/prices")
        ? new Response(
            JSON.stringify({
              object: "list",
              data: [videoPlan, { ...videoPlan, plan_id: "unreviewed-plan" }],
            }),
            { status: 200 },
          )
        : new Response(
            JSON.stringify({
              object: "balance",
              available_points: 10_000,
              unit: "points",
            }),
            { status: 200 },
          ),
  });
  assert.equal(discovered.availability, "available");
  assert.equal(discovered.unavailableReason, null);
  assert.equal(discovered.plans.length, 1);
  assert.equal(discovered.plans[0]?.planId, "video-plan-02");
});

test("discovery fails closed when the audited video plan is missing", async () => {
  const discovered = await discoverShuyuVideoRoute({
    env: { SHUYU_API_KEY: "configured" },
    fetchImpl: async (input) =>
      String(input).endsWith("/health")
        ? new Response(JSON.stringify(healthPayload), { status: 200 })
        : String(input).endsWith("/prices")
        ? new Response(
            JSON.stringify({
              object: "list",
              data: [{ ...videoPlan, plan_id: "video-plan-03", unit: "second", sale_points: 88 }],
            }),
            { status: 200 },
          )
        : new Response(
            JSON.stringify({
              object: "balance",
              available_points: 10_000,
              unit: "points",
            }),
            { status: 200 },
          ),
  });
  assert.equal(discovered.availability, "unavailable");
  assert.equal(discovered.unavailableReason, "price_contract_mismatch");
  assert.deepEqual(discovered.plans, []);
});

test("discovery fails closed when health is 503 even if price and balance look usable", async () => {
  const discovered = await discoverShuyuVideoRoute({
    env: { SHUYU_API_KEY: "configured" },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(
          JSON.stringify({
            error: {
              type: "service_unavailable",
              message: "The API is temporarily unavailable.",
            },
          }),
          { status: 503 },
        );
      }
      if (url.endsWith("/prices")) {
        return new Response(
          JSON.stringify({ object: "list", data: [videoPlan] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          object: "balance",
          available_points: 180_000,
          unit: "points",
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(discovered.availability, "unavailable");
  assert.equal(discovered.unavailableReason, "upstream_unavailable");
  assert.deepEqual(discovered.plans, []);
});

test("missing key performs no upstream discovery", async () => {
  let calls = 0;
  const discovered = await discoverShuyuVideoRoute({
    env: {},
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(discovered, {
    id: "buddy",
    provider: "shuyu",
    displayName: "Shuyu API",
    apiBaseUrl: SHUYU_API_BASE_URL,
    discoveryMode: "health_prices_and_balance_read_only_non_billing",
    availability: "unavailable",
    configured: false,
    funded: false,
    unavailableReason: "not_configured",
    plans: [],
    contract: {
      submitPath: "/videos/generations",
      statusPath: "/tasks/{task_id}",
      balancePath: "/account/balance",
      requestFields: [
        "plan_id",
        "model",
        "mode",
        "prompt",
        "duration",
        "aspect_ratio",
        "input_images",
      ],
      statuses: [
        "queued",
        "processing",
        "completed",
        "failed",
        "refund_pending",
        "refund_error",
        "refunded",
      ],
    },
  });
});
