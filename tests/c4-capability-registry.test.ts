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
  isCapabilityKey,
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
    "src/components/capabilities/capability-board.tsx",
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

test("能力键齐全：文本 / 看图 / 产品图 / 配图 / 视频 / 邮件（配音、图库、抓取、抠图 2026-11-16、内容审核 2026-11-17 随线路删除）", () => {
  assert.deepEqual([...CAPABILITY_KEYS], ["text", "vision", "image", "graphics", "video", "email"]);
  for (const gone of ["voice", "stock", "scrape", "cutout", "moderation"]) {
    assert.equal(isCapabilityKey(gone), false, `${gone} 不再是能力键：库里的旧行读的时候被过滤掉`);
  }
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

test("写作暂停：如实说现在写不了镜头脚本、故事板先生成不了，恢复后自动启用（2026-11-17 起没有模板退路）", () => {
  assert.equal(CAPABILITY_COPY.text.messages.unavailable["zh-CN"], "AI 写作暂停：现在写不了镜头脚本，故事板先生成不了；恢复后自动启用。");
  assert.match(CAPABILITY_COPY.text.messages.unavailable["en-US"], /resumes automatically/);
  for (const status of ["degraded", "unavailable", "not_configured"] as const) {
    assert.doesNotMatch(CAPABILITY_COPY.text.messages[status]["zh-CN"], /模板/, `${status}：写不成没有模板退路，不许再这么说`);
  }
  // 暂停文案都要说「恢复后」怎么办或改用什么，不能只说「不可用」
  for (const key of ["text", "vision", "image", "graphics", "video"] as const) {
    assert.match(CAPABILITY_COPY[key].messages.unavailable["zh-CN"], /恢复后|照常|保留|不受影响/, key);
  }
  // 文案不再提已经删掉的线路（实拍图库 / 配音 / 链接抓取 / 抠图）与已删的页面（周计划 / 图文帖 / 产品图）
  for (const key of CAPABILITY_KEYS) {
    assert.doesNotMatch(CAPABILITY_COPY[key].label["zh-CN"], /产品图|配图|周计划/, key);
    assert.doesNotMatch(CAPABILITY_COPY[key].label["en-US"], /product image|post image|weekly/i, key);
    for (const status of CAPABILITY_STATUSES) {
      const message = CAPABILITY_COPY[key].messages[status];
      assert.doesNotMatch(message["zh-CN"], /实拍|图库|配音|抓取|抠图|周计划|图文帖|产品图|生成配图/, `${key}.${status}`);
      assert.doesNotMatch(message["en-US"], /stock|voiceover|link import|cutout|weekly|image post|product image/i, `${key}.${status}`);
    }
  }
  assert.equal(CAPABILITY_COPY.image.label["zh-CN"], "开场画面出图（GPT Image 2）");
  assert.equal(CAPABILITY_COPY.video.label["zh-CN"], "视频生成（Seedance 2.5）");
  assert.equal(CAPABILITY_COPY.graphics.label["zh-CN"], "Logo");
  // 看图暂停：如实说故事板先生成不了，做好的成片不受影响
  assert.match(CAPABILITY_COPY.vision.messages.unavailable["zh-CN"], /故事板先生成不了.*已经做好的成片不受影响/);
});

test("看图文案只写现在真在用的事：出方案时看商品图；成片画面质检已删（2026-11-16），不再承诺", () => {
  for (const status of CAPABILITY_STATUSES) {
    const zh = CAPABILITY_COPY.vision.messages[status]["zh-CN"];
    const en = CAPABILITY_COPY.vision.messages[status]["en-US"];
    assert.doesNotMatch(zh, /一致性/, status);
    assert.doesNotMatch(en, /consistency/i, status);
    /// 质检已删：状态页不能再说「成片会自动检查错字与水印」
    assert.doesNotMatch(zh, /质检|错字|水印/, status);
    assert.doesNotMatch(en, /frame check|burned-in|watermark/i, status);
    assert.match(zh, /商品图/, status);
    assert.match(zh, /镜头脚本|写进每个镜头/, status);
  }
  assert.equal(CAPABILITY_COPY.vision.messages.available["zh-CN"], "AI 看图正常：写镜头脚本时会看你的商品图，把商品的样子写进每个镜头。");
});

test("P03-K：视频「不稳定」不承诺备用线路（生产没有可切的套餐），无论什么原因都只说正在自动重试", () => {
  const degraded = CAPABILITY_COPY.video.messages.degraded;
  assert.doesNotMatch(degraded["zh-CN"], /备用/);
  assert.doesNotMatch(degraded["en-US"], /backup/i);
  assert.match(degraded["zh-CN"], /正在自动重试/);
  assert.match(degraded["zh-CN"], /已完成的成片不受影响/);
  for (const key of CAPABILITY_KEYS) {
    for (const status of CAPABILITY_STATUSES) {
      assert.doesNotMatch(CAPABILITY_COPY[key].messages[status]["zh-CN"], /备用线路|备用套餐/, `${key}.${status}`);
      assert.doesNotMatch(CAPABILITY_COPY[key].messages[status]["en-US"], /backup (line|plan)/i, `${key}.${status}`);
    }
  }
  /// 文案只看状态，不按原因换词：套餐漂移与限流说的是同一句
  for (const reason of ["contract_drift", "rate_limited", "upstream"] as const) {
    const view = resolveCapabilities({
      records: [record("video", { status: "degraded", reason, checkedAt: NOW.toISOString() })],
      configured: ALL_CONFIGURED,
      now: NOW,
    });
    assert.deepEqual(view.items.find((item) => item.key === "video")!.message, degraded, reason);
  }
});

test("功能依赖写在一处：口播稿 / 脚本 = 写作；故事板 = Shuyu 图像、Logo = OpenAI 图像；已删功能（含故事板审帧、上传审核）不在表里", () => {
  assert.deepEqual([...FEATURE_KEYS], ["scriptWriting", "logo", "storyboardFrames", "videoGeneration", "leadEmail"]);
  for (const gone of [
    "broll",
    "linkImport",
    "productCutout",
    "frameQa",
    "contentPlanWriting",
    "imagePosts",
    "productImages",
    "storyboardReview",
    "uploadReview",
  ]) {
    assert.equal((FEATURE_KEYS as readonly string[]).includes(gone), false, gone);
  }
  for (const feature of FEATURE_KEYS) {
    for (const need of FEATURES[feature].needs) assert.ok(isCapabilityKey(need), `${feature} 依赖的 ${need} 必须是现存的能力键`);
  }
  /// 写脚本是「看图 + 写作」一次调用：两样缺一样都写不成
  assert.deepEqual([...FEATURES.scriptWriting.needs], ["text", "vision"]);
  assert.deepEqual([...FEATURES.logo.needs], ["graphics"]);
  assert.deepEqual([...FEATURES.storyboardFrames.needs], ["image"]);
  assert.deepEqual([...FEATURES.videoGeneration.needs], ["video"]);
  assert.deepEqual([...FEATURES.leadEmail.needs], ["email"]);
  /// 写镜头脚本要看商品图：看图暂停就写不了脚本
  assert.deepEqual(featuresForCapability("vision"), ["scriptWriting"]);
  for (const feature of FEATURE_KEYS) {
    assert.doesNotMatch(FEATURES[feature].whenBlocked["en-US"], CJK, feature);
    assert.match(FEATURES[feature].whenBlocked["zh-CN"], CJK, feature);
  }
  assert.deepEqual(featuresForCapability("video"), ["videoGeneration"]);
  assert.deepEqual(featuresForCapability("email"), ["leadEmail"]);
  assert.deepEqual(featuresForCapability("graphics"), ["logo"]);
  assert.deepEqual(featuresForCapability("image"), ["storyboardFrames"]);
  assert.deepEqual(featuresForCapability("text"), ["scriptWriting"]);
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

test("failingSince：进入异常记当刻、持续异常保留最早那刻、恢复清空；细节只留这一次观测的", () => {
  const t0 = new Date("2026-10-25T10:00:00.000Z");
  const t1 = new Date("2026-10-25T11:00:00.000Z");
  const t2 = new Date("2026-10-25T12:00:00.000Z");
  const first = nextCapabilityRecord(
    record("vision", { detail: { model: "old-model" } }),
    "vision",
    { status: "unavailable", reason: "permission", detail: { httpStatus: 403 } },
    t0,
    "probe",
  );
  assert.equal(first.failingSince, t0.toISOString());
  assert.equal(first.detail?.httpStatus, 403);
  assert.equal(first.detail?.model, undefined, "上一条观测的细节不带到下一条");

  const second = nextCapabilityRecord(first, "vision", { status: "degraded", reason: "upstream" }, t1, "runtime");
  assert.equal(second.failingSince, t0.toISOString(), "不稳定 ↔ 暂停之间不重置起点");
  assert.equal(second.source, "runtime");
  assert.equal(second.detail, undefined);

  const recovered = nextCapabilityRecord(second, "vision", { status: "available", reason: "ok" }, t2, "runtime");
  assert.equal(recovered.failingSince, null);
  assert.equal(recovered.checkedAt, t2.toISOString());

  const notConfigured = nextCapabilityRecord(first, "vision", { status: "not_configured", reason: "not_configured" }, t2, "config");
  assert.equal(notConfigured.failingSince, null, "未开通是配置，不是故障");
});

/* ── 客户视图 ───────────────────────────────────────────────────────── */

test("视图：配置以运行时为准（撤掉 key 即未开通）；从没检测过 = 正常但标「未检测」", () => {
  const view = resolveCapabilities({
    records: [record("graphics", { status: "available" })],
    configured: { ...ALL_CONFIGURED, graphics: false, email: false },
    now: NOW,
  });
  const graphics = view.items.find((item) => item.key === "graphics")!;
  assert.equal(graphics.status, "not_configured", "上次探测「正常」也按未开通显示");
  const image = view.items.find((item) => item.key === "image")!;
  assert.equal(image.status, "available");
  assert.equal(image.reason, "unchecked");
  assert.equal(image.checkedAt, null);
  assert.equal(view.counts.not_configured, 2);
  assert.equal(view.paused, false);
  assert.equal(view.items.length, CAPABILITY_KEYS.length);
  assert.ok(view.items.every((item) => item.message["zh-CN"] === CAPABILITY_COPY[item.key].messages[item.status]["zh-CN"]));
});

test("视图：库里已删线路的旧行（voice / stock / scrape / cutout / moderation）不进视图、不计数、不点亮暂停", () => {
  const stale = (["voice", "stock", "scrape", "cutout", "moderation"] as const).map(
    (key) => ({ ...record("text", { status: "unavailable", reason: "permission" }), key }) as unknown as CapabilityRecord,
  );
  const view = resolveCapabilities({ records: stale, configured: ALL_CONFIGURED, now: NOW });
  assert.deepEqual(view.items.map((item) => item.key), [...CAPABILITY_KEYS]);
  assert.equal(view.paused, false);
  assert.equal(view.counts.unavailable, 0);
  assert.equal(view.counts.available, CAPABILITY_KEYS.length);
});

test("视图：OpenAI 账户没额度（文本 quota 且更新）→ 看图 / 配图一起显示暂停；走别家的出图、出片不受影响", () => {
  const view = resolveCapabilities({
    records: [
      record("text", {
        status: "unavailable",
        reason: "quota",
        checkedAt: NOW.toISOString(),
        failingSince: new Date(NOW.getTime() - 60 * MINUTE).toISOString(),
      }),
      record("graphics", { status: "available", checkedAt: new Date(NOW.getTime() - 30 * MINUTE).toISOString() }),
      record("video", { status: "available" }),
    ],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  const byKey = new Map(view.items.map((item) => [item.key, item]));
  for (const key of ["vision", "graphics"] as const) {
    assert.equal(byKey.get(key)?.status, "unavailable", key);
    assert.equal(byKey.get(key)?.reason, "quota", key);
    assert.equal(byKey.get(key)?.failingSince, new Date(NOW.getTime() - 60 * MINUTE).toISOString(), key);
  }
  for (const key of ["video", "image"] as const) assert.equal(byKey.get(key)?.status, "available", key);
  assert.equal(view.paused, true);
  assert.equal(view.counts.unavailable, 3);
});

test("视图：账户失败之后才来的直接证据（生产里出图成功）以新证据为准", () => {
  const view = resolveCapabilities({
    records: [
      record("text", { status: "unavailable", reason: "quota", checkedAt: new Date(NOW.getTime() - 30 * MINUTE).toISOString() }),
      record("graphics", { status: "available", source: "runtime", checkedAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString() }),
    ],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(view.items.find((item) => item.key === "graphics")?.status, "available");
  // 文本自己的 403（某个模型没权限）不是账户层问题，不连坐
  const permissionOnly = resolveCapabilities({
    records: [record("text", { status: "unavailable", reason: "permission", checkedAt: NOW.toISOString() })],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(permissionOnly.items.find((item) => item.key === "graphics")?.status, "available");
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
  const gate = featureGate(null, "scriptWriting");
  assert.equal(gate.status, "available");
  assert.equal(gate.message, null);
});

test("闸门：依赖暂停即被挡，原因写清楚是哪一项、改用什么", () => {
  const view = resolveCapabilities({
    records: [record("text", { status: "unavailable", reason: "quota", checkedAt: NOW.toISOString() }), record("vision")],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  const gate = featureGate(view, "scriptWriting");
  assert.equal(gate.status, "blocked");
  /// 写作和看图用同一个账户：写作因额度暂停时看图跟着暂停，两项都列出来
  assert.deepEqual(gate.blockedBy, ["text", "vision"]);
  assert.match(gate.message?.["zh-CN"] ?? "", /^镜头脚本暂停：AI 写作、AI 看图暂不可用。暂时生成不了新的故事板；恢复后自动启用，已经做好的成片不受影响。$/);
  assert.match(gate.message?.["en-US"] ?? "", /^Shot script paused \(unavailable: AI writing, AI vision\)\./);
  assert.equal(featureGate(view, "storyboardFrames").status, "available", "故事板出图走另一家供应商，不受影响");
});

test("闸门：未开通与暂停分开说；不稳定只提示可能变慢、不挡", () => {
  const view = resolveCapabilities({
    records: [record("text", { status: "unavailable", reason: "quota", checkedAt: NOW.toISOString() })],
    configured: { ...ALL_CONFIGURED, email: false },
    now: NOW,
  });
  // 暂停说「暂不可用」，没配 key 说「尚未开通」
  const email = featureGate(view, "leadEmail");
  assert.equal(email.status, "blocked");
  assert.match(email.message?.["zh-CN"] ?? "", /邮件通知尚未开通/);
  assert.match(email.message?.["en-US"] ?? "", /\(not set up: Email alerts\)/);

  const unstable = resolveCapabilities({
    records: [record("image", { status: "degraded", reason: "upstream" }), record("vision", { status: "degraded", reason: "upstream" })],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  const frames = featureGate(unstable, "storyboardFrames");
  assert.equal(frames.status, "degraded");
  assert.deepEqual(frames.degradedBy, ["image"]);
  assert.equal(frames.message?.["zh-CN"], "故事板可能变慢：开场画面出图（GPT Image 2）不稳定。");
  assert.equal(frames.message?.["en-US"], "Storyboards may be slow (unstable: Opening frame (GPT Image 2)).");
  /// 看图不稳定：镜头脚本跟着标成可能变慢（写脚本要看商品图），别的功能不受牵连
  assert.equal(featureGate(unstable, "scriptWriting").status, "degraded");
  assert.deepEqual(featureGate(unstable, "scriptWriting").degradedBy, ["vision"]);
  for (const feature of FEATURE_KEYS.filter((key) => key !== "storyboardFrames" && key !== "scriptWriting")) {
    assert.equal(featureGate(unstable, feature).status, "available", feature);
  }
});

test("中文拼接：拉丁字母结尾的名字后补空格（「Logo 暂不可用」），汉字结尾不补", () => {
  const view = resolveCapabilities({
    records: [record("graphics", { status: "unavailable", reason: "permission", checkedAt: NOW.toISOString() })],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(
    featureGate(view, "logo").message?.["zh-CN"],
    "Logo 生成暂停：Logo 暂不可用。暂时不能生成 Logo，可以先在品牌页上传现有 Logo。",
  );
});
