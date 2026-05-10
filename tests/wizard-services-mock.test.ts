import assert from "node:assert/strict";
import test from "node:test";

/**
 * 这一组是 wizard service 层的「无 DB」单元测试：
 * 我们只验证可以纯函数测试的部分（mock fallback 选择、QA 默认值映射、shooting guide 转换）。
 *
 * 真正涉及 db.* 的写入路径在 Phase 3 集成测试覆盖（需要 PostgreSQL）。
 * 这里通过测试 prompt 层 + mock 行为，给 wizard service 的关键逻辑兜底。
 */

import { mockClientScript } from "../src/lib/prompts/client-script";
import { mockStoryboard } from "../src/lib/prompts/storyboard";
import { buildShootingGuideFromStoryboard } from "../src/lib/prompts/shooting-guide";
import { parseScriptOutput } from "../src/lib/schemas/script-output";
import { parseStoryboardOutput } from "../src/lib/schemas/storyboard";
import { parseShootingGuideDoc } from "../src/lib/schemas/shooting-guide";
import { parseClientBrief } from "../src/lib/schemas/client-brief";
import {
  wizardAssetRegisterSchema,
} from "../src/lib/services/wizard-asset-service";
import {
  readScriptOutputFromMetadata,
  serializeScriptOutputForMetadata,
} from "../src/lib/services/wizard-script-service";
import { reconstructScriptOutputForPrompt } from "../src/lib/services/wizard-storyboard-service";

const brief = parseClientBrief({
  businessName: "Pawsitive Pet Spa",
  industry: "pet_business",
  objective: "increase_bookings",
  targetPlatforms: ["tiktok"],
  videoLengthSec: 30,
  brandTone: "warm",
  brandAssets: { ctaText: "Book a session" },
  candidateCardSlugs: [],
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
});

test("wizard mock script → strict ScriptOutput schema parse passes", () => {
  const mock = mockClientScript({ brief });
  const validated = parseScriptOutput(mock);
  assert.equal(validated.copiedFromReference, false);
  assert.ok(validated.complianceNotes.length > 0, "pet_business should emit at least one compliance note");
});

test("wizard mock storyboard → strict Storyboard schema parse passes", () => {
  const script = parseScriptOutput(mockClientScript({ brief }));
  const sb = mockStoryboard({ brief, script });
  const validated = parseStoryboardOutput(sb);
  assert.equal(validated.totalDurationSec, brief.videoLengthSec);
  assert.ok(validated.shots.length >= 3);
});

test("shooting guide builder produces N items aligned with storyboard sceneIndex", () => {
  const script = parseScriptOutput(mockClientScript({ brief }));
  const sb = parseStoryboardOutput(mockStoryboard({ brief, script }));
  const guide = parseShootingGuideDoc(
    buildShootingGuideFromStoryboard({ storyboard: sb, brief }),
  );
  assert.equal(guide.items.length, sb.shots.length);
  for (let i = 0; i < sb.shots.length; i++) {
    assert.equal(guide.items[i]!.sceneIndex, sb.shots[i]!.sceneIndex);
  }
});

test("wizardAssetRegisterSchema accepts a typical public URL payload", () => {
  const out = wizardAssetRegisterSchema.parse({
    type: "VIDEO",
    url: "https://cdn.example.com/clip.mp4",
    name: "storefront.mp4",
    mimeType: "video/mp4",
    durationMs: 4500,
    width: 1080,
    height: 1920,
    fileSizeBytes: 15_000_000,
    assetRole: "hook",
  });
  assert.equal(out.type, "VIDEO");
  assert.equal(out.assetRole, "hook");
});

test("wizardAssetRegisterSchema rejects non-URL", () => {
  assert.throws(() =>
    wizardAssetRegisterSchema.parse({
      type: "VIDEO",
      url: "not-a-url",
      name: "bad",
    }),
  );
});

test("wizardAssetRegisterSchema rejects unknown type", () => {
  assert.throws(() =>
    wizardAssetRegisterSchema.parse({
      type: "WHATEVER" as unknown as "VIDEO",
      url: "https://cdn.example.com/clip.mp4",
      name: "x.mp4",
    }),
  );
});

/// ---------- Phase 3A: Script.metadata round-trip ----------

test("Phase 3A: ScriptOutput can round-trip through Script.metadata serialize/read", () => {
  const original = parseScriptOutput(mockClientScript({ brief }));
  /// 序列化为 Prisma JSON 输入
  const serialized = serializeScriptOutputForMetadata(original);
  /// Prisma 取回会变成 unknown 形态的 JSON 对象，模拟之
  const fromDb: unknown = JSON.parse(JSON.stringify(serialized));
  const restored = readScriptOutputFromMetadata(fromDb);
  assert.ok(restored, "round-trip should yield a non-null ScriptOutput");
  assert.equal(restored.title, original.title);
  assert.equal(restored.hook, original.hook);
  assert.equal(restored.cta, original.cta);
  assert.equal(restored.captions.length, original.captions.length);
  assert.equal(
    restored.complianceNotes.length,
    original.complianceNotes.length,
    "complianceNotes 必须无丢失",
  );
});

test("Phase 3A: readScriptOutputFromMetadata returns null on missing/invalid (no throw)", () => {
  assert.equal(readScriptOutputFromMetadata(null), null);
  assert.equal(readScriptOutputFromMetadata(undefined), null);
  /// JSON null 字面量也应该被拒绝（不抛错）
  assert.equal(readScriptOutputFromMetadata("not-an-object"), null);
  assert.equal(readScriptOutputFromMetadata([1, 2, 3]), null);
  /// 字段不全的 partial 也应返回 null（parse 失败兜底）
  assert.equal(readScriptOutputFromMetadata({ language: "en" }), null);
});

test("Phase 3A: reconstructScriptOutputForPrompt 优先使用 metadata.scriptOutput", async () => {
  const cached = parseScriptOutput(mockClientScript({ brief }));
  const result = await reconstructScriptOutputForPrompt({
    scriptId: "test-script-1",
    language: "en",
    fullText: "ignored when scriptOutput is present",
    hook: "old hook",
    cta: "old cta",
    scriptOutput: cached,
  });
  /// 应直接返回 metadata 里的 cached（含 captions），而不是从 fullText markdown 反向解析
  assert.equal(result, cached, "应直接复用 cached（同一引用）");
  assert.equal(result.captions.length, cached.captions.length);
});

test("Phase 3A: reconstructScriptOutputForPrompt 缺失 metadata 时回退 markdown 解析", async () => {
  /// 老 Script 行（无 metadata）：用 markdown 反向解析路径
  const result = await reconstructScriptOutputForPrompt({
    scriptId: "legacy-script",
    language: "en",
    fullText: "# Legacy Title\n\n## Hook\nOld hook line\n\n## Voiceover\nThis is a fallback voiceover body that has more than ten characters.\n\n## CTA\nLegacy CTA",
    hook: "Old hook line",
    cta: "Legacy CTA",
    scriptOutput: null,
  });
  assert.equal(result.title, "Legacy Title");
  assert.equal(result.hook, "Old hook line");
  assert.equal(result.cta, "Legacy CTA");
  assert.equal(result.captions.length, 0, "回退路径 captions 仍应为空（行为兼容）");
});
