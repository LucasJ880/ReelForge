import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { CapabilityRecord } from "../src/lib/capabilities/registry";
import {
  CAPABILITY_CACHE_TTL_MS,
  CAPABILITY_RUNTIME_REFRESH_MS,
  __resetCapabilityCacheForTests,
  __setCapabilityStoreForTests,
  capabilityConfiguration,
  capabilityRecordToRow,
  createMemoryCapabilityStore,
  getCapabilities,
  isCapabilityWriteThroughEnabled,
  markCapability,
  rowToCapabilityRecord,
  type CapabilityStore,
} from "../src/lib/services/capability-status-service";
import { getTtsProvider } from "../src/lib/providers/tts";
import { searchStockClips } from "../src/lib/providers/stock-footage";
import { chatJsonByTier, openai } from "../src/lib/providers/openai";

/**
 * C4 · 生产调用实时回写：成功即正常、账户层错误即暂停；同状态 10 分钟只写一次；
 * 永不抛出；node:test 子进程里默认绝不写库（打桩的 429 不能写进生产状态表）。
 */

const NOW = new Date("2026-10-25T12:00:00.000Z");
const MINUTE = 60_000;

function useStore(t: TestContext, initial: CapabilityRecord[] = []) {
  const store = createMemoryCapabilityStore(initial);
  __setCapabilityStoreForTests(store);
  t.after(() => __setCapabilityStoreForTests(null));
  return store;
}

function withEnv(t: TestContext, patch: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("开关：node:test 子进程、没有 DATABASE_URL、本地 next dev 都不写；脚本显式 =1 才写；=0 总闸", () => {
  __setCapabilityStoreForTests(null);
  assert.equal(process.env.NODE_TEST_CONTEXT ? true : false, true, "本测试应在 node --test 子进程里跑");
  assert.equal(isCapabilityWriteThroughEnabled(), false);
  assert.equal(isCapabilityWriteThroughEnabled({ DATABASE_URL: "postgres://x", CAPABILITY_WRITE_THROUGH: "1" }), true);
  assert.equal(isCapabilityWriteThroughEnabled({ CAPABILITY_WRITE_THROUGH: "1" }), false, "没有库就不写");
  assert.equal(isCapabilityWriteThroughEnabled({ DATABASE_URL: "postgres://x", NODE_ENV: "development" }), false);
  assert.equal(
    isCapabilityWriteThroughEnabled({ DATABASE_URL: "postgres://x", CAPABILITY_WRITE_THROUGH: "1", NODE_TEST_CONTEXT: "child-v8" }),
    false,
  );
  assert.equal(isCapabilityWriteThroughEnabled({ DATABASE_URL: "postgres://x", CAPABILITY_WRITE_THROUGH: "0" }), false);
});

test("没注入存储时 markCapability 是空操作（测试里打桩的调用不会碰任何库）", async () => {
  __setCapabilityStoreForTests(null);
  await markCapability("text", { error: { status: 429, code: "insufficient_quota" } });
  await markCapability("text", "success");
  // 不抛、不挂即可；真正的写入路径由下面注入存储的用例覆盖
});

test("成功 → 正常（runtime）；同状态 10 分钟内不重复写；过了 10 分钟再写一次", async (t) => {
  const store = useStore(t);
  await markCapability("text", "success", { now: NOW, detail: { provider: "openai", model: "gpt-5.6-terra" } });
  assert.equal(store.writes.length, 1);
  assert.deepEqual(
    { status: store.writes[0]?.status, reason: store.writes[0]?.reason, source: store.writes[0]?.source },
    { status: "available", reason: "ok", source: "runtime" },
  );
  assert.equal(store.writes[0]?.detail?.model, "gpt-5.6-terra");

  await markCapability("text", "success", { now: new Date(NOW.getTime() + 5 * MINUTE) });
  assert.equal(store.writes.length, 1, "10 分钟内同状态不写");

  await markCapability("text", "success", { now: new Date(NOW.getTime() + CAPABILITY_RUNTIME_REFRESH_MS + MINUTE) });
  assert.equal(store.writes.length, 2);
});

test("账户层错误 → 立刻暂停并记 failingSince；持续失败保留起点；恢复后清空", async (t) => {
  const store = useStore(t);
  await markCapability("voice", { error: { status: 403, message: "Project does not have access to model tts-1" } }, { now: NOW });
  const paused = store.records.get("voice");
  assert.equal(paused?.status, "unavailable");
  assert.equal(paused?.reason, "permission");
  assert.equal(paused?.failingSince, NOW.toISOString());
  assert.equal(paused?.detail?.httpStatus, 403);

  await markCapability("voice", { error: { status: 429, code: "insufficient_quota" } }, { now: new Date(NOW.getTime() + MINUTE) });
  assert.equal(store.records.get("voice")?.reason, "quota", "原因变了就写");
  assert.equal(store.records.get("voice")?.failingSince, NOW.toISOString(), "起点不变");

  await markCapability("voice", "success", { now: new Date(NOW.getTime() + 2 * MINUTE) });
  assert.equal(store.records.get("voice")?.status, "available");
  assert.equal(store.records.get("voice")?.failingSince, null);
});

test("超时 / 5xx / 普通限流不改状态（一个抖动不能把整站标成暂停）", async (t) => {
  const store = useStore(t);
  await markCapability("text", { error: new Error("ECONNRESET") }, { now: NOW });
  await markCapability("text", { error: { status: 500, message: "server error" } }, { now: NOW });
  await markCapability("text", { error: { status: 429, message: "Rate limit reached for requests" } }, { now: NOW });
  assert.equal(store.writes.length, 0);
});

test("存储写失败也绝不抛给调用方", async (t) => {
  const broken: CapabilityStore = {
    readAll: async () => {
      throw new Error("db down");
    },
    read: async () => {
      throw new Error("db down");
    },
    write: async () => {
      throw new Error("db down");
    },
  };
  __setCapabilityStoreForTests(broken);
  t.after(() => __setCapabilityStoreForTests(null));
  await markCapability("text", "success", { now: NOW });
  await markCapability("text", { error: { status: 401 } }, { now: NOW });
});

test("getCapabilities：读失败退回「按配置显示」不抛；60 秒内走缓存；fresh 强制回库", async (t) => {
  let reads = 0;
  const failing: CapabilityStore = {
    readAll: async () => {
      reads += 1;
      throw new Error("relation \"CapabilityStatus\" does not exist");
    },
    read: async () => null,
    write: async () => {},
  };
  __resetCapabilityCacheForTests();
  t.after(() => __resetCapabilityCacheForTests());
  const env = { OPENAI_API_KEY: "sk-test" };
  const view = await getCapabilities({ store: failing, env, now: NOW });
  assert.equal(view.items.find((item) => item.key === "text")?.status, "available");
  assert.equal(view.items.find((item) => item.key === "text")?.reason, "unchecked");
  assert.equal(view.items.find((item) => item.key === "stock")?.status, "not_configured");
  assert.equal(view.paused, false);

  const counting = createMemoryCapabilityStore([
    {
      key: "text",
      status: "unavailable",
      reason: "quota",
      source: "probe",
      checkedAt: NOW.toISOString(),
      failingSince: NOW.toISOString(),
    },
  ]);
  let countingReads = 0;
  const store: CapabilityStore = {
    ...counting,
    readAll: async () => {
      countingReads += 1;
      return counting.readAll();
    },
  };
  __resetCapabilityCacheForTests();
  const first = await getCapabilities({ store, env, now: NOW });
  assert.equal(first.items.find((item) => item.key === "text")?.status, "unavailable");
  await getCapabilities({ store, env, now: new Date(NOW.getTime() + 30_000) });
  assert.equal(countingReads, 1, "60 秒内走进程内缓存");
  await getCapabilities({ store, env, now: new Date(NOW.getTime() + CAPABILITY_CACHE_TTL_MS + 1_000) });
  assert.equal(countingReads, 2);
  await getCapabilities({ store, env, now: new Date(NOW.getTime() + CAPABILITY_CACHE_TTL_MS + 2_000), fresh: true });
  assert.equal(countingReads, 3);
  assert.ok(reads >= 1);
});

test("行 ↔ 记录：原因与来源存进 detail；坏行（未知 key / 状态）丢弃", () => {
  const record: CapabilityRecord = {
    key: "voice",
    status: "unavailable",
    reason: "permission",
    source: "probe",
    checkedAt: NOW.toISOString(),
    failingSince: NOW.toISOString(),
    detail: { provider: "openai", httpStatus: 403, ttsProbedAt: NOW.toISOString() },
  };
  const row = capabilityRecordToRow(record);
  assert.deepEqual(row.detail, { reason: "permission", source: "probe", provider: "openai", httpStatus: 403, ttsProbedAt: NOW.toISOString() });
  assert.deepEqual(rowToCapabilityRecord({ key: "voice", ...row }), record);
  assert.equal(rowToCapabilityRecord({ key: "telepathy", status: "available", detail: null, checkedAt: NOW, failingSince: null }), null);
  assert.equal(rowToCapabilityRecord({ key: "text", status: "melting", detail: null, checkedAt: NOW, failingSince: null }), null);
});

test("配置判据：邮件要 key + 发件人；图库 Pexels 或 Pixabay 任一；Shuyu 认大小写两种变量名", () => {
  const config = capabilityConfiguration({
    OPENAI_API_KEY: "sk",
    shuyu_api_key: "s",
    PIXABAY_API_KEYS: " ,px ",
    RESEND_API_KEY: "re_x",
  });
  assert.equal(config.text, true);
  assert.equal(config.image, true);
  assert.equal(config.video, true);
  assert.equal(config.stock, true);
  assert.equal(config.email, false, "缺 EMAIL_FROM");
  assert.equal(config.scrape, false);
  assert.equal(capabilityConfiguration({ OPENAI_API_KEY: "sk", IMAGE_ENGINE_MOCK: "true" }).graphics, false);
});

/* ── 生产调用点真的会回写 ──────────────────────────────────────────── */

test("TTS：403 没有模型权限 → 配音暂停；成功合成 → 正常", async (t) => {
  const store = useStore(t);
  withEnv(t, { OPENAI_API_KEY: "sk-test-key" });
  const denied = (async () =>
    new Response(JSON.stringify({ error: { message: "Project proj_x does not have access to model tts-1" } }), { status: 403 })) as typeof fetch;
  await assert.rejects(getTtsProvider({ fetchImpl: denied }).synthesize({ text: "你好", language: "zh" }));
  assert.equal(store.records.get("voice")?.status, "unavailable");
  assert.equal(store.records.get("voice")?.reason, "permission");

  const ok = (async () => new Response(new Uint8Array(2048), { status: 200 })) as typeof fetch;
  const { audio } = await getTtsProvider({ fetchImpl: ok }).synthesize({ text: "你好", language: "zh" });
  assert.equal(audio.byteLength, 2048);
  assert.equal(store.records.get("voice")?.status, "available");
});

test("图库：key 被拒（401）→ 图库暂停；搜索成功 → 正常", async (t) => {
  const store = useStore(t);
  withEnv(t, { PEXELS_API_KEYS: "pexels-test", PIXABAY_API_KEYS: undefined });
  const rejected = (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;
  await assert.rejects(searchStockClips({ term: "blinds", aspect: "portrait", fetchImpl: rejected }));
  assert.deepEqual(
    { status: store.records.get("stock")?.status, reason: store.records.get("stock")?.reason },
    { status: "unavailable", reason: "auth" },
  );
  const ok = (async () => new Response(JSON.stringify({ videos: [] }), { status: 200 })) as typeof fetch;
  await searchStockClips({ term: "blinds", aspect: "portrait", fetchImpl: ok });
  assert.equal(store.records.get("stock")?.status, "available");
});

test("写作：chatJsonByTier 撞上 429 额度 → 写作暂停；之后一次成功 → 恢复（整条回退链只回写一次结论）", async (t) => {
  const store = useStore(t);
  withEnv(t, { OPENAI_API_KEY: "sk-test-key", LLM_FORCE_MOCK: undefined, DIRECTOR_FORCE_MOCK: undefined, SCRIPT_FORCE_MOCK: undefined, AIVORA_DRY_RUN: undefined });
  const completions = openai.chat.completions as unknown as { create: (...args: unknown[]) => Promise<unknown> };
  const original = completions.create;
  t.after(() => {
    completions.create = original;
  });

  completions.create = async () => {
    throw Object.assign(new Error("429 You exceeded your current quota"), { status: 429, code: "insufficient_quota" });
  };
  await assert.rejects(chatJsonByTier({ tier: "fast", system: "Reply in json.", user: "json please" }));
  assert.deepEqual(
    { status: store.records.get("text")?.status, reason: store.records.get("text")?.reason },
    { status: "unavailable", reason: "quota" },
  );
  assert.equal(store.writes.length, 1, "额度错误不走回退链，只写一次");

  completions.create = async () => ({ choices: [{ message: { content: "{\"ok\":true}" } }], usage: null });
  const result = await chatJsonByTier<{ ok: boolean }>({ tier: "fast", system: "Reply in json.", user: "json please" });
  assert.equal(result.data.ok, true);
  assert.equal(store.records.get("text")?.status, "available");
  assert.equal(store.records.get("text")?.failingSince, null);
});
