/**
 * X-SCAF-4：真值表新探针的纯函数——Seedance 2.5 档识别（夹具 JSON，不触网）与实验 key 配置探测
 * （只报配没配，输出里绝不出现 key 值）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { listAuditedShuyuVideoPlans, shuyuPricesResponseSchema } from "../src/lib/providers/shuyu";
import {
  describeSeedance25Signal,
  detectShuyuSeedance25,
} from "../src/lib/providers/shuyu-seedance25-probe";
import { summarizeShuyuCatalog } from "../src/lib/services/capability-probe-service";
import {
  experimentKeyPresence,
  ttsKeyPresence,
} from "../scripts/lib/experiment-key-presence";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("当前价目表：没有 2.5 档、没有 30s、没有参考字段；严格 schema 照常解析", () => {
  const payload = fixture("shuyu-prices-current.json");
  const signal = detectShuyuSeedance25(payload);
  assert.equal(signal.entryCount, 3);
  assert.equal(signal.detected, false);
  assert.deepEqual(signal.duration30PlanIds, []);
  assert.deepEqual(signal.referencePlanIds, []);
  assert.equal(shuyuPricesResponseSchema.safeParse(payload).success, true);
  assert.match(describeSeedance25Signal(signal, true), /未出现 2\.5 档（3 条目）/);
});

test("2.5 上架：按 display_name / model 认出候选，报 30s、音频/视频参考字段、新 mode 与生成开关", () => {
  const payload = fixture("shuyu-prices-seedance25.json");
  const signal = detectShuyuSeedance25(payload);
  assert.equal(signal.detected, true);
  assert.deepEqual(
    signal.candidates.map((candidate) => candidate.planId),
    ["video-plan-25-1080", "video-plan-25-720"],
  );
  const hd = signal.candidates[0];
  assert.equal(hd.supports30s, true);
  assert.deepEqual(hd.durations, [5, 10, 15, 20, 30]);
  assert.deepEqual(hd.referenceFields, ["input_audios_max", "input_videos_max"]);
  assert.deepEqual(hd.unknownModes, ["reference2video"]);
  assert.deepEqual(hd.generationSwitches, ["generate_audio"]);
  assert.equal(signal.candidates[1].supports30s, false);
  assert.deepEqual(signal.duration30PlanIds, ["video-plan-25-1080"]);
  assert.deepEqual(signal.referencePlanIds, ["video-plan-25-1080"]);
});

test("2.5 带 30s / 新 mode 上架不打穿价目表：只丢那一档，2.0 档照常可审计；探针读原始 JSON 报出被丢的档", () => {
  const payload = fixture("shuyu-prices-seedance25.json");
  const parsed = shuyuPricesResponseSchema.safeParse(payload);
  assert.equal(parsed.success, true, "一档不认识不能让整张表 invalid_response");
  const kept = parsed.success ? parsed.data.data.map((plan) => plan.plan_id) : [];
  assert.ok(kept.includes("video-plan-04"), "现有 2.0 档保留");
  /// 未知 mode 只被忽略，档本身保留；按 display_name 认成 2.5 家族（1080P = final，排在 draft 之后），
  /// model 不是 studio-video 的「Studio Video Pro」不入族。
  assert.ok(kept.includes("video-plan-25-1080"));
  const audited = parsed.success ? listAuditedShuyuVideoPlans(parsed.data.data).map((plan) => plan.planId) : [];
  assert.deepEqual(audited, ["video-plan-04", "video-plan-25-1080"]);
  const line = describeSeedance25Signal(detectShuyuSeedance25(payload), parsed.success, ["video-plan-25-1080"]);
  assert.match(line, /出现 2\.5 候选档 2 个/);
  assert.match(line, /含 30s/);
  assert.match(line, /有音频\/视频参考字段/);
  assert.match(line, /逐条校验丢弃 1 档.*video-plan-25-1080/);
  assert.doesNotMatch(line, /外层 schema 解析失败/);
});

test("识别规则：2.5 的写法变体都认，25/2.50/12.5 之类不误报；非 video 条目忽略；畸形输入不抛", () => {
  const entry = (display_name: string, kind = "video") => ({ plan_id: display_name, kind, display_name });
  const detected = (name: string, kind?: string) =>
    detectShuyuSeedance25({ data: [entry(name, kind)] }).detected;
  assert.equal(detected("Seedance 2.5 Pro"), true);
  assert.equal(detected("seedance-2-5"), true);
  assert.equal(detected("seedance_2_5_fast"), true);
  assert.equal(detected("Seedance 2.50"), false);
  assert.equal(detected("Plan 25"), false);
  assert.equal(detected("Seedance 2.5", "image"), false);
  assert.equal(detectShuyuSeedance25(null).entryCount, 0);
  assert.equal(detectShuyuSeedance25({ data: "x" }).entryCount, 0);
  assert.equal(detectShuyuSeedance25([42, null, { kind: "video" }]).entryCount, 1);
});

test("summarizeShuyuCatalog 带上 2.5 信号（严格解析后能看到的那部分）", () => {
  const parsed = shuyuPricesResponseSchema.parse(fixture("shuyu-prices-current.json"));
  const withNamed25 = [
    ...parsed.data,
    { ...parsed.data[1], plan_id: "video-plan-25", display_name: "Seedance 2.5 · 720P" },
  ];
  assert.deepEqual(summarizeShuyuCatalog(parsed.data).seedance25, { detected: false, candidatePlanIds: [] });
  assert.deepEqual(summarizeShuyuCatalog(withNamed25).seedance25, {
    detected: true,
    candidatePlanIds: ["video-plan-25"],
  });
});

const SECRETS = {
  SYNC_API_KEY: "sync-secret-AAAA1111",
  ELEVENLABS_API_KEY: "el-secret-BBBB2222",
  MINIMAX_API_KEY: "mm-secret-CCCC3333",
  REMOVE_BG_API_KEY: "rbg-secret-DDDD4444",
  CLIPDROP_API_KEY: "cd-secret-EEEE5555",
};

test("实验 key：全部配齐 → 已配置；输出里不出现任何 key 值（连片段都没有）", () => {
  const rows = experimentKeyPresence({ ...SECRETS, TTS_PROVIDER: "ElevenLabs" });
  assert.deepEqual(rows.map((row) => row.verdict), ["已配置", "已配置", "已配置"]);
  const text = JSON.stringify(rows);
  for (const secret of Object.values(SECRETS)) {
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(secret.slice(-4)), false);
    assert.equal(text.includes(secret.slice(0, 6)), false);
  }
  assert.match(rows[2].detail, /REMOVE_BG_API_KEY \+ CLIPDROP_API_KEY/);
});

test("实验 key：全空 → 未配置；空白字符串也算没配", () => {
  const rows = experimentKeyPresence({ SYNC_API_KEY: "   " });
  assert.deepEqual(rows.map((row) => row.verdict), ["未配置", "未配置", "未配置"]);
});

test("TTS：缺 provider、provider 不认识、provider 对但缺 key 分别说清楚", () => {
  assert.match(ttsKeyPresence({ MINIMAX_API_KEY: SECRETS.MINIMAX_API_KEY }).detail, /缺 TTS_PROVIDER（已有 MINIMAX_API_KEY）/);
  const wrong = ttsKeyPresence({ TTS_PROVIDER: "openai" });
  assert.equal(wrong.verdict, "配置有误");
  const missing = ttsKeyPresence({ TTS_PROVIDER: "minimax", ELEVENLABS_API_KEY: SECRETS.ELEVENLABS_API_KEY });
  assert.deepEqual([missing.verdict, missing.detail], ["未配置", "TTS_PROVIDER=minimax 但缺 MINIMAX_API_KEY"]);
  assert.equal(ttsKeyPresence({ TTS_PROVIDER: "minimax", MINIMAX_API_KEY: SECRETS.MINIMAX_API_KEY }).verdict, "已配置");
});
