import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  CAPABILITY_COPY,
  CAPABILITY_KEYS,
  CAPABILITY_STATUSES,
  FEATURES,
  FEATURE_KEYS,
  featureGate,
  featuresForCapability,
  nextCapabilityRecord,
  resolveCapabilities,
  type CapabilityKey,
  type CapabilityRecord,
} from "../src/lib/capabilities/registry";
import { STATE_VOCAB, stateTone, stateWord } from "../src/lib/exchange/state-vocab";

/**
 * C4 · 一份能力注册表：纯模块（客户端可引）、文案诚实（说清楚还能用什么、改用什么）、
 * 依赖关系写死在一处、状态推进与「账户没额度时一起停」的推断可验证。
 */

const SRC = resolve(process.cwd(), "src");
const NOW = new Date("2026-10-25T12:00:00.000Z");
const MINUTE = 60_000;
const ALL_CONFIGURED = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as Record<CapabilityKey, boolean>;

function record(key: CapabilityKey, overrides: Partial<CapabilityRecord> = {}): CapabilityRecord {
  return {
    key,
    status: "available",
    reason: "ok",
    source: "probe",
    checkedAt: new Date(NOW.getTime() - 10 * MINUTE).toISOString(),
    failingSince: null,
    ...overrides,
  };
}

/* ── 纯度：客户端可以安全 import ─────────────────────────────────────── */

function valueImports(source: string): string[] {
  const specs: string[] = [];
  const re = /import\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const named = match[1]?.match(/\{([\s\S]*)\}/)?.[1];
    if (named !== undefined) {
      const parts = named.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((part) => part.startsWith("type "))) continue;
    }
    specs.push(match[2]!);
  }
  const bare = /import\s+["']([^"']+)["']/g;
  while ((match = bare.exec(source))) specs.push(match[1]!);
  const dynamic = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamic.exec(source))) specs.push(match[1]!);
  return specs;
}

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** 从 entry 出发的全部值依赖（含动态 import），返回命中禁区的链路。 */
function forbiddenChain(entry: string, forbidden: (spec: string) => boolean): string[] | null {
  const seen = new Set<string>();
  const stack: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
  while (stack.length) {
    const { file, chain } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      if (forbidden(spec)) return [...chain, spec];
      const next = resolveSpec(spec, file);
      if (next) stack.push({ file: next, chain: [...chain, next] });
    }
  }
  return null;
}

const SERVER_ONLY = (spec: string) =>
  spec === "openai" ||
  spec.startsWith("openai/") ||
  spec === "@/lib/db" ||
  spec === "@/lib/ai" ||
  spec.startsWith("@/lib/ai/") ||
  spec.startsWith("@/lib/services/") ||
  spec.startsWith("@/lib/providers/") ||
  spec === "@prisma/client" ||
  spec.startsWith("next/headers") ||
  spec.startsWith("node:");

test("注册表是纯模块：零值依赖（只允许 type import），客户端可以安全 import", () => {
  const source = readFileSync("src/lib/capabilities/registry.ts", "utf8");
  assert.deepEqual(valueImports(source), [], "registry.ts 不得有任何值 import");
  assert.doesNotMatch(source, /process\.env|require\(|fetch\(/);
});

test("C4 客户端组件不（直接或传递地）引服务端模块：OpenAI / Prisma / service / provider", () => {
  const entries = [
    "src/lib/capabilities/registry.ts",
    "src/components/capabilities/capability-indicator.tsx",
    "src/components/capabilities/use-capabilities.ts",
    "src/components/capabilities/capability-notice.tsx",
    "src/components/capabilities/capability-board.tsx",
    "src/components/video-generation/broll-quick-card.tsx",
    "src/components/video-generation/audio-caption-controls.tsx",
    "src/components/platform/platform-shell.tsx",
  ];
  const violations = entries
    .map((entry) => forbiddenChain(resolve(entry), SERVER_ONLY))
    .filter((chain): chain is string[] => chain !== null)
    .map((chain) => chain.map((part) => part.replace(SRC, "src")).join(" → "));
  assert.deepEqual(violations, []);
});

test("没有任何 'use client' 文件传递地引到能力状态 / 探测 service（它们会懒加载 Prisma）", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) out.push(full);
    }
    return out;
  };
  const clientFiles = walk(SRC).filter((file) => /^\s*["']use client["']/m.test(readFileSync(file, "utf8").slice(0, 200)));
  assert.ok(clientFiles.length > 50);
  const violations = clientFiles
    .map((file) =>
      forbiddenChain(file, (spec) =>
        spec === "@/lib/services/capability-status-service" || spec === "@/lib/services/capability-probe-service",
      ),
    )
    .filter((chain): chain is string[] => chain !== null)
    .map((chain) => chain.map((part) => part.replace(SRC, "src")).join(" → "));
  assert.deepEqual(violations, []);
});

/* ── 能力与文案 ─────────────────────────────────────────────────────── */

test("能力键齐全：文本 / 看图 / 产品图 / 配图 / 视频 / 配音 / 审核 / 图库 / 抓取 / 抠图 / 邮件", () => {
  assert.deepEqual(
    [...CAPABILITY_KEYS],
    ["text", "vision", "image", "graphics", "video", "voice", "moderation", "stock", "scrape", "cutout", "email"],
  );
  assert.deepEqual([...CAPABILITY_STATUSES], ["available", "degraded", "unavailable", "not_configured"]);
});

const CJK = /[㐀-鿿！-｠　-〿]/;
/** 客户文案不写供应商与模型名（运维细节只进 detail）。 */
const VENDOR = /OpenAI|Shuyu|Pexels|Pixabay|Firecrawl|remove\.bg|Clipdrop|Resend|gpt-|tts-1|Image 2|熔断|circuit breaker/i;

test("每个能力 × 每种状态都有中英一句人话：中文有中文、英文没中文、不露供应商名", () => {
  for (const key of CAPABILITY_KEYS) {
    const copy = CAPABILITY_COPY[key];
    assert.ok(copy.label["zh-CN"] && copy.label["en-US"], `${key} label`);
    assert.doesNotMatch(copy.label["en-US"], CJK, `${key} en label`);
    for (const status of CAPABILITY_STATUSES) {
      const message = copy.messages[status];
      assert.match(message["zh-CN"], CJK, `${key}.${status} zh`);
      assert.doesNotMatch(message["en-US"], CJK, `${key}.${status} en`);
      for (const text of [message["zh-CN"], message["en-US"]]) {
        assert.doesNotMatch(text, VENDOR, `${key}.${status}: ${text}`);
      }
    }
  }
});

test("写作暂停：照抄验收口径——脚本与周计划先用模板生成，恢复后自动启用", () => {
  assert.equal(CAPABILITY_COPY.text.messages.unavailable["zh-CN"], "AI 写作暂停：脚本与周计划先用模板生成，恢复后自动启用。");
  assert.match(CAPABILITY_COPY.text.messages.unavailable["en-US"], /templates/);
  // 暂停文案都要说「恢复后」怎么办或改用什么，不能只说「不可用」
  for (const key of ["text", "vision", "image", "graphics", "video", "voice"] as const) {
    assert.match(CAPABILITY_COPY[key].messages.unavailable["zh-CN"], /恢复后|照常|保留|不受影响/, key);
  }
  // 配音暂停只停实拍线路：主线视频的原生口播不受影响
  assert.match(CAPABILITY_COPY.voice.messages.unavailable["zh-CN"], /原生口播不受影响/);
  // 画面质检暂停：成片照常生成
  assert.match(CAPABILITY_COPY.vision.messages.unavailable["zh-CN"], /成片照常生成/);
});

test("功能依赖写在一处：实拍线路 = 写作 + 配音 + 图库；周计划 / 口播稿 = 写作；图文配图 = Shuyu 图像、Logo = OpenAI 图像；画面质检 = 看图", () => {
  assert.deepEqual([...FEATURES.broll.needs], ["text", "voice", "stock"]);
  assert.deepEqual([...FEATURES.contentPlanWriting.needs], ["text"]);
  assert.deepEqual([...FEATURES.narrationDraft.needs], ["text"]);
  assert.deepEqual([...FEATURES.scriptWriting.needs], ["text"]);
  /// C2：图文配图默认走 Shuyu 图像线路
  assert.deepEqual([...FEATURES.imagePosts.needs], ["image"]);
  assert.deepEqual([...FEATURES.logo.needs], ["graphics"]);
  assert.deepEqual([...FEATURES.productImages.needs], ["image"]);
  assert.deepEqual([...FEATURES.storyboardFrames.needs], ["image"]);
  assert.deepEqual([...FEATURES.videoGeneration.needs], ["video"]);
  assert.deepEqual([...FEATURES.frameQa.needs], ["vision"]);
  for (const feature of FEATURE_KEYS) {
    assert.doesNotMatch(FEATURES[feature].whenBlocked["en-US"], CJK, feature);
    assert.match(FEATURES[feature].whenBlocked["zh-CN"], CJK, feature);
  }
  assert.deepEqual(featuresForCapability("voice"), ["broll"]);
  assert.deepEqual(featuresForCapability("graphics"), ["logo"]);
  assert.ok(featuresForCapability("image").includes("imagePosts"));
});

test("状态词典有 capability 一行：记号与颜色成对（暂停 = 失败记号，未开通 = 叉）", () => {
  assert.deepEqual(Object.keys(STATE_VOCAB.capability), ["available", "degraded", "unavailable", "not_configured"]);
  assert.equal(stateWord("capability", "available", "zh-CN"), "正常");
  assert.equal(stateWord("capability", "unavailable", "zh-CN"), "暂停");
  assert.equal(stateWord("capability", "not_configured", "en-US"), "Not set up");
  assert.equal(stateTone("capability", "available"), "filled");
  assert.equal(stateTone("capability", "degraded"), "partial");
  assert.equal(stateTone("capability", "unavailable"), "fault");
  assert.equal(stateTone("capability", "not_configured"), "void");
});

/* ── 状态推进 ───────────────────────────────────────────────────────── */

test("failingSince：进入异常记当刻、持续异常保留最早那刻、恢复清空；TTS 探测时刻跨观测保留", () => {
  const t0 = new Date("2026-10-25T10:00:00.000Z");
  const t1 = new Date("2026-10-25T11:00:00.000Z");
  const t2 = new Date("2026-10-25T12:00:00.000Z");
  const first = nextCapabilityRecord(
    record("voice", { detail: { ttsProbedAt: "2026-10-25T09:00:00.000Z" } }),
    "voice",
    { status: "unavailable", reason: "permission", detail: { httpStatus: 403 } },
    t0,
    "probe",
  );
  assert.equal(first.failingSince, t0.toISOString());
  assert.equal(first.detail?.ttsProbedAt, "2026-10-25T09:00:00.000Z");
  assert.equal(first.detail?.httpStatus, 403);

  const second = nextCapabilityRecord(first, "voice", { status: "degraded", reason: "upstream" }, t1, "runtime");
  assert.equal(second.failingSince, t0.toISOString(), "不稳定 ↔ 暂停之间不重置起点");
  assert.equal(second.source, "runtime");
  assert.equal(second.detail?.ttsProbedAt, "2026-10-25T09:00:00.000Z");

  const recovered = nextCapabilityRecord(second, "voice", { status: "available", reason: "ok" }, t2, "runtime");
  assert.equal(recovered.failingSince, null);
  assert.equal(recovered.checkedAt, t2.toISOString());

  const notConfigured = nextCapabilityRecord(first, "voice", { status: "not_configured", reason: "not_configured" }, t2, "config");
  assert.equal(notConfigured.failingSince, null, "未开通是配置，不是故障");
});

/* ── 客户视图 ───────────────────────────────────────────────────────── */

test("视图：配置以运行时为准（撤掉 key 即未开通）；从没检测过 = 正常但标「未检测」", () => {
  const view = resolveCapabilities({
    records: [record("stock", { status: "available" })],
    configured: { ...ALL_CONFIGURED, stock: false, email: false },
    now: NOW,
  });
  const stock = view.items.find((item) => item.key === "stock")!;
  assert.equal(stock.status, "not_configured");
  const scrape = view.items.find((item) => item.key === "scrape")!;
  assert.equal(scrape.status, "available");
  assert.equal(scrape.reason, "unchecked");
  assert.equal(scrape.checkedAt, null);
  assert.equal(view.counts.not_configured, 2);
  assert.equal(view.paused, false);
  assert.equal(view.items.length, CAPABILITY_KEYS.length);
  assert.ok(view.items.every((item) => item.message["zh-CN"] === CAPABILITY_COPY[item.key].messages[item.status]["zh-CN"]));
});

test("视图：OpenAI 账户没额度（文本 quota 且更新）→ 看图 / 配图 / 配音一起显示暂停；审核端点免费不受影响", () => {
  const view = resolveCapabilities({
    records: [
      record("text", {
        status: "unavailable",
        reason: "quota",
        checkedAt: NOW.toISOString(),
        failingSince: new Date(NOW.getTime() - 60 * MINUTE).toISOString(),
      }),
      record("voice", { status: "available", checkedAt: new Date(NOW.getTime() - 30 * MINUTE).toISOString() }),
      record("moderation", { status: "available" }),
    ],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  const byKey = new Map(view.items.map((item) => [item.key, item]));
  for (const key of ["vision", "graphics", "voice"] as const) {
    assert.equal(byKey.get(key)?.status, "unavailable", key);
    assert.equal(byKey.get(key)?.reason, "quota", key);
    assert.equal(byKey.get(key)?.failingSince, new Date(NOW.getTime() - 60 * MINUTE).toISOString(), key);
  }
  assert.equal(byKey.get("moderation")?.status, "available");
  assert.equal(view.paused, true);
  assert.equal(view.counts.unavailable, 4);
});

test("视图：账户失败之后才来的直接证据（生产里配音成功）以新证据为准", () => {
  const view = resolveCapabilities({
    records: [
      record("text", { status: "unavailable", reason: "quota", checkedAt: new Date(NOW.getTime() - 30 * MINUTE).toISOString() }),
      record("voice", { status: "available", source: "runtime", checkedAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString() }),
    ],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(view.items.find((item) => item.key === "voice")?.status, "available");
  // 文本自己的 403（某个模型没权限）不是账户层问题，不连坐
  const permissionOnly = resolveCapabilities({
    records: [record("text", { status: "unavailable", reason: "permission", checkedAt: NOW.toISOString() })],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(permissionOnly.items.find((item) => item.key === "voice")?.status, "available");
});

test("视图：只有不稳定没有暂停 → unstable；lastCheckedAt 取最近一次检测", () => {
  const latest = new Date(NOW.getTime() - MINUTE).toISOString();
  const view = resolveCapabilities({
    records: [record("video", { status: "degraded", reason: "contract_drift", checkedAt: latest, failingSince: latest })],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(view.paused, false);
  assert.equal(view.unstable, true);
  assert.equal(view.lastCheckedAt, latest);
});

/* ── 功能闸门 ───────────────────────────────────────────────────────── */

test("闸门：没有能力视图一律放行（我们自己的状态表故障不能拦客户）", () => {
  const gate = featureGate(null, "broll");
  assert.equal(gate.status, "available");
  assert.equal(gate.message, null);
});

test("闸门：实拍线路任一依赖暂停即被挡，原因写清楚是哪几项、改用什么", () => {
  const view = resolveCapabilities({
    records: [
      record("text", { status: "unavailable", reason: "quota", checkedAt: NOW.toISOString() }),
      record("voice", { status: "unavailable", reason: "permission", checkedAt: NOW.toISOString() }),
    ],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  const gate = featureGate(view, "broll");
  assert.equal(gate.status, "blocked");
  assert.deepEqual(gate.blockedBy, ["text", "voice"]);
  assert.equal(
    gate.message?.["zh-CN"],
    "实拍图库线路暂停：AI 写作、AI 配音暂不可用。可以先用上方主线生成视频，恢复后这里自动开放。",
  );
  assert.equal(
    gate.message?.["en-US"],
    "Stock footage route paused (unavailable: AI writing, AI voiceover). Use the main flow above for now; this route reopens automatically once it recovers.",
  );
  assert.equal(featureGate(view, "productImages").status, "available", "产品图走另一家供应商，不受影响");
});

test("闸门：未开通与暂停分开说；不稳定只提示可能变慢、不挡", () => {
  const view = resolveCapabilities({
    records: [record("text", { status: "unavailable", reason: "quota", checkedAt: NOW.toISOString() })],
    configured: { ...ALL_CONFIGURED, stock: false },
    now: NOW,
  });
  const gate = featureGate(view, "broll");
  // 文本是账户层额度问题 → 配音一起停（同一个计费账户）；图库是没配 key
  assert.match(gate.message?.["zh-CN"] ?? "", /AI 写作、AI 配音暂不可用；图库素材尚未开通/);
  assert.match(gate.message?.["en-US"] ?? "", /\(unavailable: AI writing, AI voiceover; not set up: Stock footage\)/);

  const unstable = resolveCapabilities({
    records: [record("vision", { status: "degraded", reason: "upstream" })],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  const qa = featureGate(unstable, "frameQa");
  assert.equal(qa.status, "degraded");
  assert.equal(qa.message?.["zh-CN"], "画面质检可能变慢：AI 看图不稳定。");
  assert.equal(qa.message?.["en-US"], "Frame checks may be slow (unstable: AI vision).");
});

test("中文拼接：拉丁字母结尾的名字后补空格（「配图与 Logo 暂不可用」），汉字结尾不补", () => {
  const view = resolveCapabilities({
    records: [record("graphics", { status: "unavailable", reason: "permission", checkedAt: NOW.toISOString() })],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(
    featureGate(view, "logo").message?.["zh-CN"],
    "Logo 生成暂停：配图与 Logo 暂不可用。暂时不能生成 Logo，可以先在品牌页上传现有 Logo。",
  );
});
