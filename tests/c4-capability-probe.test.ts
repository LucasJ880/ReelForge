import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyHttpStatus,
  classifyNetworkError,
  classifyRuntimeFailure,
  safeNote,
} from "../src/lib/capabilities/classify";
import { CAPABILITY_KEYS, resolveCapabilities } from "../src/lib/capabilities/registry";
import {
  runCapabilityProbeCycle,
  shuyuCapabilityObservations,
  summarizeShuyuCatalog,
  type ProbeResult,
} from "../src/lib/services/capability-probe-service";
import {
  capabilityConfiguration,
  createMemoryCapabilityStore,
} from "../src/lib/services/capability-status-service";

/**
 * C4 · 探测归类与每小时一轮的全能力探测（全部注入 fetch / 存储 / Shuyu，不连任何真实供应商）。
 * 单测只验「归类与编排」；真实端点是否这样回，由 scripts/e2e-1025/route-truth-table.ts 真机核对。
 */

const NOW = new Date("2026-10-25T12:00:00.000Z");
const HOUR = 60 * 60_000;

/* ── 归类 ───────────────────────────────────────────────────────────── */

test("归类：429 insufficient_quota → 暂停（额度）；普通 429 → 不稳定（限流）", () => {
  const quota = classifyHttpStatus(429, JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } }));
  assert.deepEqual([quota.status, quota.reason], ["unavailable", "quota"]);
  const noCredits = classifyHttpStatus(429, "429 You have no credits remaining. Add credits to continue");
  assert.deepEqual([noCredits.status, noCredits.reason], ["unavailable", "quota"]);
  const limited = classifyHttpStatus(429, JSON.stringify({ error: { message: "Rate limit reached for requests" } }));
  assert.deepEqual([limited.status, limited.reason], ["degraded", "rate_limited"]);
});

test("归类：401 / 403 → 暂停（401 = key 被拒，403 没模型权限 = permission）；402 → 额度", () => {
  assert.deepEqual(Object.values(pick(classifyHttpStatus(401, "invalid_api_key"))), ["unavailable", "auth"]);
  assert.deepEqual(
    Object.values(pick(classifyHttpStatus(403, "Project proj_x does not have access to model tts-1"))),
    ["unavailable", "permission"],
  );
  assert.deepEqual(Object.values(pick(classifyHttpStatus(403, "Forbidden"))), ["unavailable", "auth"]);
  assert.deepEqual(Object.values(pick(classifyHttpStatus(402, "Payment Required"))), ["unavailable", "quota"]);
  assert.deepEqual(
    Object.values(pick(classifyHttpStatus(404, JSON.stringify({ error: { code: "model_not_found", message: "The model gpt-x does not exist" } })))),
    ["unavailable", "permission"],
  );
});

test("归类：5xx / 超时 / 网络错误 → 不稳定；2xx → 正常；探测本身的 400 不拦客户", () => {
  assert.deepEqual(Object.values(pick(classifyHttpStatus(200))), ["available", "ok"]);
  assert.deepEqual(Object.values(pick(classifyHttpStatus(503, "upstream"))), ["degraded", "upstream"]);
  assert.deepEqual(Object.values(pick(classifyHttpStatus(400, "bad request"))), ["degraded", "unknown"]);
  const network = classifyNetworkError(new TypeError("fetch failed"));
  assert.deepEqual(Object.values(pick(network)), ["degraded", "upstream"]);
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(classifyNetworkError(abort).detail?.note, "timeout");
});

test("归类（生产回写）：只认账户层错误；限流 / 网络抖动不回写", () => {
  assert.deepEqual(pick(classifyRuntimeFailure({ status: 429, code: "insufficient_quota", message: "quota" })!), { status: "unavailable", reason: "quota" });
  assert.deepEqual(
    pick(classifyRuntimeFailure({ status: 403, message: "Project does not have access to model gpt-4o-mini-tts" })!),
    { status: "unavailable", reason: "permission" },
  );
  assert.deepEqual(pick(classifyRuntimeFailure({ status: 401, message: "Incorrect API key" })!), { status: "unavailable", reason: "auth" });
  assert.deepEqual(pick(classifyRuntimeFailure({ code: "insufficient_balance", httpStatus: 402 })!), { status: "unavailable", reason: "quota" });
  assert.deepEqual(pick(classifyRuntimeFailure({ status: 402 })!), { status: "unavailable", reason: "quota" });
  assert.equal(classifyRuntimeFailure({ status: 429, message: "Rate limit reached for requests" }), null);
  assert.equal(classifyRuntimeFailure(new Error("ECONNRESET")), null);
  assert.equal(classifyRuntimeFailure({ status: 500, message: "server error" }), null);
  assert.equal(classifyRuntimeFailure(null), null);
  // 我们自己抛的错（JSON 解析失败夹着模型原文）里出现 "no credits" 不算供应商结论
  assert.equal(classifyRuntimeFailure(new Error("OpenAI 返回的不是合法 JSON：原文：{\"hook\":\"no credits needed\"")), null);
});

test("运维 note 脱敏：不留 key", () => {
  assert.equal(safeNote("Bearer sk-abcdefghijklmnop failed"), "Bearer sk-[REDACTED] failed");
  assert.equal(safeNote("https://pixabay.com/api/videos/?key=secret123&q=x"), "https://pixabay.com/api/videos/?key=[REDACTED]&q=x");
  assert.equal(safeNote(""), undefined);
});

function pick(observation: { status: string; reason: string }) {
  return { status: observation.status, reason: observation.reason };
}

/* ── Shuyu：/prices + 余额 → 产品图与故事板 / 视频 ───────────────────── */

const SHUYU_OK: Pick<ProbeResult, "auditedPlanFound" | "videoPlansGone" | "drifts" | "catalog" | "fetchError"> = {
  auditedPlanFound: true,
  videoPlansGone: false,
  drifts: [],
  catalog: { imagePlanCount: 2, cheapestImagePoints: 24, cheapestVideo15sPoints: 700 },
  fetchError: null,
};

test("Shuyu：契约匹配 + 余额够 → 两条都正常，余额记进运维细节", () => {
  const result = shuyuCapabilityObservations(SHUYU_OK, { points: 5_000 });
  assert.equal(result.video.status, "available");
  assert.equal(result.image.status, "available");
  assert.equal(result.video.detail?.balancePoints, 5_000);
});

test("Shuyu：余额不够一条 15 秒视频 → 视频暂停（额度），图还能出", () => {
  const result = shuyuCapabilityObservations(SHUYU_OK, { points: 300 });
  assert.deepEqual(pick(result.video), { status: "unavailable", reason: "quota" });
  assert.deepEqual(pick(result.image), { status: "available", reason: "ok" });
});

test("Shuyu：套餐漂移 → 视频不稳定；视频套餐消失 → 暂停；图像套餐消失 → 产品图暂停；key 被拒 → 都暂停", () => {
  assert.deepEqual(
    pick(shuyuCapabilityObservations({ ...SHUYU_OK, auditedPlanFound: false, drifts: [{ field: "durations", expected: "15", actual: "5,10" }] }, null).video),
    { status: "degraded", reason: "contract_drift" },
  );
  assert.deepEqual(
    pick(shuyuCapabilityObservations({ ...SHUYU_OK, auditedPlanFound: false, videoPlansGone: true }, null).video),
    { status: "unavailable", reason: "contract_drift" },
  );
  assert.deepEqual(
    pick(shuyuCapabilityObservations({ ...SHUYU_OK, catalog: { imagePlanCount: 0, cheapestImagePoints: null, cheapestVideo15sPoints: 700 } }, null).image),
    { status: "unavailable", reason: "contract_drift" },
  );
  const rejected = shuyuCapabilityObservations({ ...SHUYU_OK, fetchError: { code: "authentication_rejected", httpStatus: 401 } }, null);
  assert.deepEqual(pick(rejected.image), { status: "unavailable", reason: "auth" });
  assert.deepEqual(pick(rejected.video), { status: "unavailable", reason: "auth" });
  const timeout = shuyuCapabilityObservations({ ...SHUYU_OK, fetchError: { code: "timeout", httpStatus: null } }, null);
  assert.deepEqual(pick(timeout.video), { status: "degraded", reason: "upstream" });
});

test("Shuyu 目录摘要：最便宜的图与 15 秒视频（与审计同一套判据）", () => {
  const summary = summarizeShuyuCatalog([
    {
      plan_id: "image-plan-02",
      kind: "image",
      model: "studio-image",
      unit: "generation",
      resolution: "2K",
      sale_points: 40,
      display_name: "GPT Image 2 · 2K",
      capabilities: { aspect_ratios: ["9:16"], input_images_max: 5 },
      status: "available",
    },
    {
      plan_id: "video-plan-01",
      kind: "video",
      model: "studio-video",
      unit: "generation",
      resolution: "720P",
      sale_points: 700,
      display_name: "Seedance 2.0 · 720P",
      capabilities: {
        aspect_ratios: ["9:16", "16:9", "1:1"],
        input_images_max: 9,
        modes: ["text2video", "image2video"],
        durations: [5, 10, 15],
      },
      status: "available",
    },
  ] as never);
  assert.deepEqual(summary, {
    imagePlanCount: 1,
    cheapestImagePoints: 40,
    cheapestVideo15sPoints: 700,
    seedance25: { detected: false, candidatePlanIds: [] },
  });
});

/* ── 一整轮（OpenAI 没额度、其余正常、邮件未配置） ── */

/// 已删线路的 key 故意留在环境里：配着也不该再有任何请求发给它们（下面的假 fetch 遇到没见过的地址就抛）
const ENV = {
  OPENAI_API_KEY: "sk-test-key-0000000000",
  SHUYU_API_KEY: "shuyu-test",
  PEXELS_API_KEYS: "pexels-test",
  FIRECRAWL_API_KEY: "fc-test",
  REMOVE_BG_API_KEY: "rb-test",
  ELEVENLABS_API_KEY: "el-test",
} as const;

/// 内容审核 2026-11-17 整套删除。线上残留的开关写成「开着」也不该再有任何审核请求、任何审核行：
/// 假 fetch 不认 /moderations，打过去就抛。
const ENV_REVIEW_LEFTOVERS = {
  ...ENV,
  CONTENT_REVIEW_ENABLED: "true",
  CONTENT_REVIEW_PROVIDER: "openai_moderation",
} as const;

type Call = { url: string; method: string; body: Record<string, unknown> | null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeProviders(overrides: Partial<Record<"chat", () => Response>> = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url.endsWith("/chat/completions")) {
      return overrides.chat?.() ?? json(429, { error: { code: "insufficient_quota", type: "insufficient_quota", message: "You exceeded your current quota" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const SHUYU_RESULT: ProbeResult = {
  provider: "shuyu",
  ok: true,
  auditedPlanFound: true,
  videoPlansGone: false,
  drifts: [],
  probedAt: NOW,
  catalog: { imagePlanCount: 2, cheapestImagePoints: 24, cheapestVideo15sPoints: 700 },
  fetchError: null,
};

function cycle(store: ReturnType<typeof createMemoryCapabilityStore>, now: Date, extra: Parameters<typeof runCapabilityProbeCycle>[0] = {}) {
  const providers = fakeProviders();
  return {
    providers,
    run: runCapabilityProbeCycle({
      env: ENV,
      fetchImpl: providers.fetchImpl,
      now: () => now,
      store,
      shuyu: SHUYU_RESULT,
      getShuyuBalance: async () => ({ available_points: 9_000 }),
      models: { text: ["gpt-5.6-terra"], vision: "gpt-5.6-terra" },
      ...extra,
    }),
  };
}

test("一整轮：OpenAI 429 额度 → 写作 / 看图暂停；其余正常；邮件未开通；已删线路（配音 / 图库 / 抓取 / 抠图 / 审核）不探也不落库", async () => {
  const store = createMemoryCapabilityStore();
  const { providers, run } = cycle(store, NOW);
  const report = await run;
  const byKey = new Map(report.items.map((item) => [item.key, item]));

  assert.deepEqual([byKey.get("text")?.status, byKey.get("text")?.reason], ["unavailable", "quota"]);
  assert.deepEqual([byKey.get("vision")?.status, byKey.get("vision")?.reason], ["unavailable", "quota"]);
  for (const key of ["image", "video"] as const) {
    assert.equal(byKey.get(key)?.status, "available", key);
  }
  assert.deepEqual(report.items.map((item) => item.key).sort(), [...CAPABILITY_KEYS].sort(), "报告只有现存的能力键");
  assert.equal(report.items.some((item) => (item.key as string) === "moderation"), false, "没有审核这一行");
  assert.equal(byKey.get("email")?.status, "not_configured");
  assert.equal(byKey.get("graphics")?.source, "derived", "配图没有便宜的探测：由账户推断");

  // 1 token：探测本身几乎不花钱
  const chat = providers.calls.find((call) => call.url.endsWith("/chat/completions"));
  assert.equal(chat?.body?.max_completion_tokens, 1);
  assert.equal(chat?.body?.model, "gpt-5.6-terra");
  // 看图与文本同一个模型：沿用文本结论，不重复花钱
  assert.equal(providers.calls.filter((call) => call.url.endsWith("/chat/completions")).length, 1);
  // 整轮只打一个地址：写作探测（Shuyu 走注入的结果；审核的探测随代码删了）
  assert.deepEqual(
    providers.calls.map((call) => new URL(call.url).pathname).sort(),
    ["/v1/chat/completions"],
  );

  // 落库：每个能力一行，没有已删的键
  assert.equal(store.records.size, CAPABILITY_KEYS.length);
  assert.deepEqual([...store.records.keys()].sort(), [...CAPABILITY_KEYS].sort());
  assert.equal(store.records.get("text")?.failingSince, NOW.toISOString());

  // 客户视图：账户没额度 → 配图也显示暂停（推断值是「未检测的正常」，被账户状态盖过）
  const view = resolveCapabilities({ records: [...store.records.values()], configured: capabilityConfiguration(ENV), now: NOW });
  assert.equal(view.items.find((item) => item.key === "graphics")?.status, "unavailable");
  assert.equal(view.paused, true);
});

test("下一轮（1 小时后）：持续失败保留最早时刻；哪一轮都不打审核端点", async () => {
  const store = createMemoryCapabilityStore();
  const first = cycle(store, NOW);
  await first.run;

  const later = cycle(store, new Date(NOW.getTime() + HOUR));
  await later.run;
  assert.equal(store.records.get("text")?.failingSince, NOW.toISOString(), "持续失败保留最早时刻");
  for (const round of [first, later]) {
    assert.equal(round.providers.calls.filter((call) => call.url.endsWith("/moderations")).length, 0);
  }
  assert.equal([...store.records.keys()].some((key) => (key as string) === "moderation"), false);
});

test("内容审核删除后：线上残留的开关写成开着也不发审核请求、不落审核行，其余各项结论与没写时一样", async () => {
  const run = async (env: Record<string, string>) => {
    const store = createMemoryCapabilityStore();
    const providers = fakeProviders({ chat: () => json(200, { choices: [{ message: { content: "" } }] }) });
    const report = await runCapabilityProbeCycle({
      env,
      fetchImpl: providers.fetchImpl,
      now: () => NOW,
      store,
      shuyu: SHUYU_RESULT,
      getShuyuBalance: async () => ({ available_points: 9_000 }),
      models: { text: ["gpt-5.6-terra"], vision: "gpt-5.6-terra" },
    });
    return {
      paths: providers.calls.map((call) => new URL(call.url).pathname).sort(),
      items: report.items.map((item) => [item.key, item.status, item.reason]),
      stored: [...store.records.keys()].sort(),
    };
  };

  const clean = await run({ ...ENV });
  assert.deepEqual(clean.paths, ["/v1/chat/completions"]);
  assert.deepEqual(clean.stored, [...CAPABILITY_KEYS].sort());
  for (const leftovers of [
    ENV_REVIEW_LEFTOVERS,
    { ...ENV, CONTENT_REVIEW_ENABLED: "true", CONTENT_REVIEW_PROVIDER: "noop" },
    { ...ENV, CONTENT_REVIEW_PROVIDER: "not-a-review-provider", CONTENT_REVIEW_MOCK: "true" },
  ] as Array<Record<string, string>>) {
    assert.deepEqual(await run(leftovers), clean, JSON.stringify(leftovers));
  }
  assert.deepEqual(Object.keys(capabilityConfiguration(ENV_REVIEW_LEFTOVERS)).sort(), [...CAPABILITY_KEYS].sort());
  assert.deepEqual(capabilityConfiguration(ENV_REVIEW_LEFTOVERS), capabilityConfiguration(ENV));
});

test("账户恢复：文本 200 → 写作恢复、failingSince 清空；配图「因账户而停」的旧结论翻回正常", async () => {
  const store = createMemoryCapabilityStore([
    {
      key: "graphics",
      status: "unavailable",
      reason: "quota",
      source: "runtime",
      checkedAt: new Date(NOW.getTime() - HOUR).toISOString(),
      failingSince: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
    },
  ]);
  const providers = fakeProviders({ chat: () => json(200, { choices: [{ message: { content: "" } }] }) });
  await runCapabilityProbeCycle({
    env: ENV,
    fetchImpl: providers.fetchImpl,
    now: () => NOW,
    store,
    shuyu: SHUYU_RESULT,
    getShuyuBalance: async () => ({ available_points: 9_000 }),
    models: { text: ["gpt-5.6-terra"], vision: "gpt-5.6-terra" },
  });
  assert.equal(store.records.get("text")?.status, "available");
  assert.equal(store.records.get("text")?.failingSince, null);
  assert.equal(store.records.get("graphics")?.status, "available");
  assert.equal(store.records.get("graphics")?.source, "derived");
});

test("邮件配好之后：生产发信回写的结论不被探测覆盖；没配 → 未开通", async () => {
  const store = createMemoryCapabilityStore([
    {
      key: "email",
      status: "unavailable",
      reason: "auth",
      source: "runtime",
      checkedAt: new Date(NOW.getTime() - HOUR).toISOString(),
      failingSince: new Date(NOW.getTime() - HOUR).toISOString(),
    },
  ]);
  const providers = fakeProviders();
  const report = await runCapabilityProbeCycle({
    env: { ...ENV, RESEND_API_KEY: "re_test", EMAIL_FROM: "Aivora <hi@example.com>" },
    fetchImpl: providers.fetchImpl,
    now: () => NOW,
    store,
    shuyu: SHUYU_RESULT,
    getShuyuBalance: async () => ({ available_points: 9_000 }),
    models: { text: ["gpt-5.6-terra"], vision: "gpt-5.6-terra" },
  });
  assert.equal(report.items.find((item) => item.key === "email")?.kept, true);
  assert.equal(store.records.get("email")?.status, "unavailable");
});

test("单项探测挂了只影响它自己：写作端点网络错误 → 写作不稳定；出图、出片照常；整轮不抛", async () => {
  const store = createMemoryCapabilityStore();
  const providers = fakeProviders({
    chat: () => {
      throw new TypeError("fetch failed");
    },
  });
  const report = await runCapabilityProbeCycle({
    env: ENV_REVIEW_LEFTOVERS,
    fetchImpl: providers.fetchImpl,
    now: () => NOW,
    store,
    shuyu: SHUYU_RESULT,
    getShuyuBalance: async () => ({ available_points: 9_000 }),
    models: { text: ["gpt-5.6-terra"], vision: "gpt-5.6-terra" },
  });
  const byKey = new Map(report.items.map((item) => [item.key, item]));
  assert.deepEqual([byKey.get("text")?.status, byKey.get("text")?.reason], ["degraded", "upstream"]);
  assert.equal(byKey.get("image")?.status, "available");
  assert.equal(byKey.get("video")?.status, "available");
  assert.equal(store.records.get("video")?.status, "available");
});

test("模型不存在（404）才换下一个候选，与生产回退链一致；看图模型不同就单独 1 token 探", async () => {
  const store = createMemoryCapabilityStore();
  const seen: string[] = [];
  const providers = fakeProviders({
    chat: () => {
      const model = String(seen.at(-1));
      return model === "gpt-missing"
        ? json(404, { error: { code: "model_not_found", message: "The model gpt-missing does not exist" } })
        : json(200, { choices: [{ message: { content: "" } }] });
    },
  });
  const tracking = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/chat/completions") && typeof init?.body === "string") {
      seen.push(String((JSON.parse(init.body) as { model: string }).model));
    }
    return providers.fetchImpl(input, init);
  }) as typeof fetch;
  await runCapabilityProbeCycle({
    env: ENV,
    fetchImpl: tracking,
    now: () => NOW,
    store,
    shuyu: SHUYU_RESULT,
    getShuyuBalance: async () => ({ available_points: 9_000 }),
    models: { text: ["gpt-missing", "gpt-5.6-terra"], vision: "gpt-5.6-sol" },
  });
  assert.deepEqual(seen, ["gpt-missing", "gpt-5.6-terra", "gpt-5.6-sol"]);
  assert.equal(store.records.get("text")?.status, "available");
  assert.equal(store.records.get("text")?.detail?.model, "gpt-5.6-terra");
  assert.equal(store.records.get("vision")?.detail?.model, "gpt-5.6-sol");
});

test("模型拒绝 1 token 上限（400）→ 放宽到 16 再试一次，不把请求形状问题挂成「写作不稳定」", async () => {
  const store = createMemoryCapabilityStore();
  let attempt = 0;
  const providers = fakeProviders({
    chat: () => {
      attempt += 1;
      return attempt === 1
        ? json(400, { error: { code: "invalid_value", message: "max_completion_tokens is too small" } })
        : json(200, { choices: [{ message: { content: "" } }] });
    },
  });
  await runCapabilityProbeCycle({
    env: ENV,
    fetchImpl: providers.fetchImpl,
    now: () => NOW,
    store,
    shuyu: SHUYU_RESULT,
    getShuyuBalance: async () => ({ available_points: 9_000 }),
    models: { text: ["gpt-5.6-terra"], vision: "gpt-5.6-terra" },
  });
  const chats = providers.calls.filter((call) => call.url.endsWith("/chat/completions"));
  assert.deepEqual(chats.map((call) => call.body?.max_completion_tokens), [1, 16]);
  assert.equal(store.records.get("text")?.status, "available");
});

test("没配 key 的能力不发请求，直接记未开通", async () => {
  const store = createMemoryCapabilityStore();
  const providers = fakeProviders();
  await runCapabilityProbeCycle({
    env: { SHUYU_API_KEY: "shuyu-test" },
    fetchImpl: providers.fetchImpl,
    now: () => NOW,
    store,
    shuyu: SHUYU_RESULT,
    getShuyuBalance: async () => ({ available_points: 9_000 }),
  });
  assert.equal(providers.calls.length, 0);
  for (const key of ["text", "vision", "graphics", "email"] as const) {
    assert.equal(store.records.get(key)?.status, "not_configured", key);
  }
  assert.equal(store.records.get("video")?.status, "available");
});

/* ── cron 接线 ─────────────────────────────────────────────────────── */

test("cron：机器鉴权在先；同一轮先探 Shuyu 再探全部能力（复用 /prices 结果）；Shuyu 漂移仍回 503", () => {
  const route = readFileSync("src/app/api/cron/capability-probe/route.ts", "utf8");
  const auth = route.indexOf("machineAuthFailure(req)");
  const shuyu = route.indexOf("probeShuyuCapabilities()");
  const all = route.indexOf("runCapabilityProbeCycle({ shuyu: result })");
  assert.ok(auth > 0 && shuyu > auth && all > shuyu, "顺序：鉴权 → Shuyu → 全能力");
  assert.match(route, /status: result\.ok \? 200 : 503/);
  assert.match(route, /\.catch\(\(error: unknown\) =>/);
});
