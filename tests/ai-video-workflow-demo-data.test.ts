import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  mainConceptVideo,
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

/* ------------------------------------------------------------------ */
/* Main Concept Video tests                                            */
/* ------------------------------------------------------------------ */

const MAIN_CONCEPT_VIDEO_RE = /^\/generated\/.+\.mp4$/;

test("mainConceptVideo exists with required fields", () => {
  assert.ok(mainConceptVideo, "mainConceptVideo must be exported");
  assert.equal(mainConceptVideo.type, "concept_demo");
  assert.ok(mainConceptVideo.title.length > 0, "title must not be empty");
  assert.ok(
    mainConceptVideo.note.length > 0,
    "note must not be empty (acts as concept-sample disclaimer)",
  );
  assert.ok(
    mainConceptVideo.durationSec > 0,
    "durationSec must be a positive number",
  );
  assert.equal(
    mainConceptVideo.aspectRatio,
    "9:16",
    "concept video is expected to be vertical 9:16 (matches the captured 720x1280 source)",
  );
});

test("mainConceptVideo.url points to /generated/*.mp4 (local concept asset)", () => {
  assert.match(
    mainConceptVideo.url,
    MAIN_CONCEPT_VIDEO_RE,
    `mainConceptVideo.url must live under /generated/ as a local mp4, got ${mainConceptVideo.url}`,
  );
});

test("mainConceptVideo file actually exists in public/generated/", () => {
  const repoRoot = process.cwd();
  const localPath = join(repoRoot, "public", mainConceptVideo.url);
  assert.ok(
    existsSync(localPath),
    `Expected concept video file to exist on disk at ${localPath}. ` +
      "If you renamed it, update mainConceptVideo.url accordingly.",
  );
});

test("finalOutputs main_30s uses the mainConceptVideo and is not a placeholder", () => {
  const main = finalOutputs.find((o) => o.variant === "main_30s");
  assert.ok(main, "main_30s output must exist");
  assert.equal(
    main!.videoUrl,
    mainConceptVideo.url,
    "main_30s.videoUrl must point to mainConceptVideo.url so the demo page shows the concept sample.",
  );
  assert.equal(
    main!.isPlaceholder,
    false,
    "main_30s must no longer be flagged as placeholder once the concept video is wired in.",
  );
});

test("finalOutputs ad_15s / cover variants stay flagged as placeholder with status note", () => {
  for (const variant of ["ad_15s", "cover"] as const) {
    const o = finalOutputs.find((x) => x.variant === variant);
    assert.ok(o, `${variant} output must exist`);
    assert.equal(
      o!.isPlaceholder,
      true,
      `${variant} should remain placeholder until a real variant is wired in.`,
    );
    assert.ok(
      o!.videoUrl === null,
      `${variant} must keep videoUrl=null while it is still a placeholder.`,
    );
    assert.ok(
      /coming next|sample variant|placeholder|示例占位|示例预览/i.test(
        `${o!.badge} ${o!.description}`,
      ),
      `${variant} must visibly be marked as a coming-next / sample variant.`,
    );
  }
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

/* ------------------------------------------------------------------ */
/* Concept-demo over-promise wording guard                             */
/* ------------------------------------------------------------------ */

const CONCEPT_DEMO_OVER_PROMISE_PHRASES: ReadonlyArray<string> = [
  "automatically generated end-to-end with no human review",
  "guaranteed viral video",
  "fully autonomous ad creation",
  "fully autonomous viral video",
  "this exact video was generated from the live wizard",
  "ai copied a trending video",
  "one-click finished commercial",
];

const DEMO_PAGE_FILES_TO_SCAN: ReadonlyArray<string> = [
  "src/app/demo/real-footage-ads/page.tsx",
  "src/app/demo/real-footage-ads/experience-client.tsx",
  "src/components/demo/demo-hero.tsx",
  "src/components/demo/final-output-section.tsx",
  "src/components/demo/storyboard-grid.tsx",
  "src/components/demo/phone-video-mockup.tsx",
  "src/lib/demo/ai-video-workflow-demo-data.ts",
];

test("demo page source files do NOT contain over-promise concept-demo wording", () => {
  const repoRoot = process.cwd();
  for (const rel of DEMO_PAGE_FILES_TO_SCAN) {
    const full = join(repoRoot, rel);
    if (!existsSync(full)) continue;
    const content = readFileSync(full, "utf8").toLowerCase();
    for (const phrase of CONCEPT_DEMO_OVER_PROMISE_PHRASES) {
      assert.ok(
        !content.includes(phrase),
        `Over-promise phrase "${phrase}" appeared in ${rel} — concept-demo wording must stay honest.`,
      );
    }
  }
});

test("compliance disclaimers explicitly negate forbidden actions", () => {
  const disclaimers = [
    ...COMPLIANCE_NOTES,
    REFERENCE_COMPLIANCE_TEXT,
  ].join("\n");
  /// 必须明确以否定形式提到 forbidden 动作（中文「不会 / 不复制 / 绝不照搬」均可）
  const negatedAtLeastOne =
    /不会下载/.test(disclaimers) ||
    /不会自托管/.test(disclaimers) ||
    /不会去水印/.test(disclaimers) ||
    /不复制/.test(disclaimers) ||
    /绝不照搬/.test(disclaimers) ||
    /we do not download/i.test(disclaimers) ||
    /we do not copy or rehost/i.test(disclaimers);
  assert.ok(
    negatedAtLeastOne,
    "合规声明必须以否定形式明确说明不做哪些动作（如「不会下载/自托管/去水印/复制」）。",
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
