import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPLIANCE_NOTES,
  FORBIDDEN_DEMO_PHRASES,
  REFERENCE_COMPLIANCE_TEXT,
  SAMPLE_DATA_BADGE_LABEL,
  SAMPLE_DATA_DISCLAIMER,
  SELECTED_CARD_DEFAULT_SLUG,
  assetQAResults,
  creativeEvidenceCards,
  demoProject,
  finalOutputs,
  generatedScript,
  petGroomingSample,
  referencePreviews,
  storyboardShots,
} from "../src/lib/demo/ai-video-workflow-demo-data";

/* ------------------------------------------------------------------ */
/* Shape tests                                                         */
/* ------------------------------------------------------------------ */

test("creativeEvidenceCards has at least 3 cards", () => {
  assert.ok(creativeEvidenceCards.length >= 3, "expected >= 3 cards");
});

test("default selected card slug exists in creativeEvidenceCards", () => {
  const found = creativeEvidenceCards.find(
    (c) => c.slug === SELECTED_CARD_DEFAULT_SLUG,
  );
  assert.ok(found, `default slug ${SELECTED_CARD_DEFAULT_SLUG} must exist`);
});

test("each creative card has required scoring + tags", () => {
  for (const card of creativeEvidenceCards) {
    assert.ok(card.recommendationScore >= 0 && card.recommendationScore <= 100);
    assert.ok(card.tags.length > 0);
    assert.ok(card.hookPattern.pattern.length >= 3);
    assert.ok(card.publicMetrics.references > 0);
  }
});

test("storyboardShots is exactly 6 shots", () => {
  assert.equal(storyboardShots.length, 6);
});

test("storyboardShots cover sceneIndex 1..6 in order", () => {
  storyboardShots.forEach((s, i) => assert.equal(s.sceneIndex, i + 1));
});

test("generatedScript captions reference valid sceneIndex range", () => {
  for (const cap of generatedScript.captions) {
    assert.ok(
      cap.sceneIndex >= 1 && cap.sceneIndex <= storyboardShots.length,
      `caption ${cap.text} has invalid sceneIndex ${cap.sceneIndex}`,
    );
  }
  assert.equal(generatedScript.copiedFromReference, false);
});

test("assetQAResults include usable / retake / missing categories", () => {
  const statuses = new Set(assetQAResults.map((r) => r.status));
  assert.ok(statuses.has("USABLE"));
  assert.ok(statuses.has("RETAKE_RECOMMENDED"));
  assert.ok(statuses.has("MISSING"));
});

test("finalOutputs include 30s main / 15s ad / cover", () => {
  const variants = new Set(finalOutputs.map((o) => o.variant));
  assert.ok(variants.has("main_30s"));
  assert.ok(variants.has("ad_15s"));
  assert.ok(variants.has("cover"));
});

test("petGroomingSample exists with 4 beats and CTA", () => {
  assert.ok(petGroomingSample);
  assert.ok(petGroomingSample.beats.length >= 4);
  assert.ok(petGroomingSample.cta.length > 0);
});

test("demoProject has industry/goal/platforms populated", () => {
  assert.ok(demoProject.industry);
  assert.ok(demoProject.goalLabel);
  assert.ok(demoProject.platforms.length >= 1);
});

/* ------------------------------------------------------------------ */
/* Compliance / forbidden wording tests                                */
/* ------------------------------------------------------------------ */

const SAFE_LOCAL_FILE_PATTERNS = [
  /^\/generated\//,
  /^\/public\//,
  /^\/demo-seed\//,
];

const REMOTE_URL_RE = /^https?:\/\//i;

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

/**
 * 收集“营销面”demo 数据的字符串 —— 排除合规免责声明（COMPLIANCE_NOTES /
 * REFERENCE_COMPLIANCE_TEXT），因为这些 disclaimer 会以否定形式（“we do NOT
 * rehost third-party videos”）合法出现，禁词扫描不应误报它们。
 */
function allMarketingDemoStrings(): string[] {
  const out: string[] = [];
  collectStrings(creativeEvidenceCards, out);
  collectStrings(referencePreviews, out);
  collectStrings(generatedScript, out);
  collectStrings(storyboardShots, out);
  collectStrings(assetQAResults, out);
  collectStrings(finalOutputs, out);
  collectStrings(petGroomingSample, out);
  collectStrings(demoProject, out);
  out.push(SAMPLE_DATA_BADGE_LABEL);
  out.push(SAMPLE_DATA_DISCLAIMER);
  return out;
}

test("demo marketing surface does NOT contain forbidden phrases", () => {
  const haystack = allMarketingDemoStrings()
    .map((s) => s.toLowerCase())
    .join("\n");
  for (const phrase of FORBIDDEN_DEMO_PHRASES) {
    assert.ok(
      !haystack.includes(phrase.toLowerCase()),
      `Forbidden phrase "${phrase}" appeared in demo marketing data — review for compliance.`,
    );
  }
});

test("compliance disclaimers explicitly negate forbidden actions", () => {
  const disclaimers = [
    ...COMPLIANCE_NOTES.map((n) => n.toLowerCase()),
    REFERENCE_COMPLIANCE_TEXT.toLowerCase(),
  ].join("\n");
  /// 必须明确说明不做这些动作之一（rehost / copy third-party videos / take watermarks off）
  const negatedAtLeastOne =
    disclaimers.includes("we do not download") ||
    disclaimers.includes("we do not copy or rehost");
  assert.ok(
    negatedAtLeastOne,
    "Compliance disclaimer must explicitly negate forbidden actions.",
  );
});

test("reference previews are external links / placeholders, not local third-party paths", () => {
  for (const ref of referencePreviews) {
    if (ref.externalUrl === null) continue;
    assert.ok(
      REMOTE_URL_RE.test(ref.externalUrl),
      `Reference for ${ref.cardSlug} has non-URL value: ${ref.externalUrl}`,
    );
  }
});

test("finalOutputs do not embed third-party local file paths", () => {
  for (const o of finalOutputs) {
    if (!o.videoUrl) continue;
    const safe =
      REMOTE_URL_RE.test(o.videoUrl) ||
      SAFE_LOCAL_FILE_PATTERNS.some((p) => p.test(o.videoUrl as string));
    assert.ok(
      safe,
      `finalOutputs.videoUrl ${o.videoUrl} is neither external URL nor a known safe local generated path`,
    );
  }
});

test("petGroomingSample videoUrl is null or external (no third-party hosted file)", () => {
  if (!petGroomingSample.videoUrl) return;
  assert.ok(
    REMOTE_URL_RE.test(petGroomingSample.videoUrl),
    `petGroomingSample.videoUrl must be external URL or null, got ${petGroomingSample.videoUrl}`,
  );
});
