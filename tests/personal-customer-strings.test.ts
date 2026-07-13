import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { containsBannedCustomerTerm } from "../src/lib/video-generation/business-status";

const ROOT = path.resolve(__dirname, "..");
const CUSTOMER_FILES = [
  "src/app/(platform)/app/library/page.tsx",
  "src/app/(platform)/app/library/[id]/page.tsx",
  "src/components/library/video-actions.tsx",
  "src/components/platform/platform-shell.tsx",
  "src/components/video-generation/plan-preview-card.tsx",
  "src/components/video-generation/unified-creative-input.tsx",
  "src/components/video-generation/unified-creative-input-shell.tsx",
];

function customerLiterals(source: string): string[] {
  const values = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((value) => value.length >= 2);
  return values.filter((value) => {
    if (/^(?:@\/|\.\.?\/|\/|https?:\/\/)/.test(value)) return false;
    if (/^[a-z]+\/[a-z0-9.+-]+$/.test(value)) return false;
    if (/^[A-Z_]+$/.test(value) || /^[a-z_][a-zA-Z0-9_]*$/.test(value)) return false;
    if (/(?:text-|bg-|border-|rounded|flex|grid|px-|py-|gap-|space-|font-|items-|justify-|hover:|sm:|md:|lg:)/.test(value)) return false;
    return true;
  });
}

test("统一客户表面不泄漏内部术语", async () => {
  const offenders: Array<{ file: string; literal: string }> = [];
  for (const file of CUSTOMER_FILES) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    for (const literal of customerLiterals(source)) {
      if (containsBannedCustomerTerm(literal)) offenders.push({ file, literal });
    }
  }
  assert.deepEqual(offenders, []);
});

test("统一成品服务做 owner 隔离、安全状态映射与 URL 过滤", async () => {
  const source = await readFile(path.join(ROOT, "src/lib/services/unified-library-service.ts"), "utf8");
  assert.match(source, /createdById:\s*userId/);
  assert.match(source, /derivePersonalStatus/);
  assert.match(source, /customerSafeFinalVideoUrl/);
  assert.doesNotMatch(source, /persona\s*===|persona:\s*"(?:BUSINESS|PERSONAL)"/);
});

test("统一成品页包含失败重试、支持提示与可行动空状态", async () => {
  const source = await readFile(path.join(ROOT, "src/app/(platform)/app/library/page.tsx"), "utf8");
  const copy = await readFile(path.join(ROOT, "src/i18n/platform-copy.ts"), "utf8");
  assert.match(source, /row\.status === "failed"/);
  assert.match(source, /copy\.regenerate/);
  assert.match(source, /copy\.failed/);
  assert.match(source, /copy\.empty/);
  assert.match(copy, /重新生成/);
  assert.match(copy, /联系支持/);
  assert.match(copy, /还没有成片/);
  assert.match(source, /\/app\/templates/);
  assert.doesNotMatch(source, /\{\s*row\.status\s*\}/);
});

test("统一详情复用 owner-scoped service 与安全 VideoActions", async () => {
  const page = await readFile(path.join(ROOT, "src/app/(platform)/app/library/[id]/page.tsx"), "utf8");
  const actions = await readFile(path.join(ROOT, "src/components/library/video-actions.tsx"), "utf8");
  assert.match(page, /getUnifiedLibraryItem\(session\.user\.id, id\)/);
  assert.match(page, /item\.videoUrl/);
  assert.doesNotMatch(page, /\{\s*item\.status\s*\}/);
  assert.match(actions, /render-status/);
  assert.match(actions, /render-retry/);
  assert.match(actions, /all:\s*true/);
});

test("方案预览不展示原始 prompt，客户看到 Scene 而非 Segment", async () => {
  const source = await readFile(path.join(ROOT, "src/components/video-generation/plan-preview-card.tsx"), "utf8");
  assert.doesNotMatch(source, /s\.prompt\.slice|Segment\s+\{|Segment\s+breakdown/i);
  assert.match(source, /Scene/);
});

test("render API 保持 brief ownership 守门", async () => {
  for (const file of [
    "src/app/api/briefs/[id]/render-retry/route.ts",
    "src/app/api/briefs/[id]/render-status/route.ts",
  ]) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    assert.match(source, /checkBriefAccess/);
    assert.doesNotMatch(source, /requireOperator/);
  }
});
