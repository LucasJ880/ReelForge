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
  localProductSample,
  mainConceptVideo,
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

test("real-estate creative cards remain intact (案例 A · workflow 主线)", () => {
  const realEstateSlugs = [
    "real-estate-comment-reply-listing",
    "real-estate-price-contrast-tour",
    "real-estate-agent-voice-broll",
  ];
  for (const slug of realEstateSlugs) {
    const card = creativeEvidenceCards.find((c) => c.slug === slug);
    assert.ok(card, `real-estate card slug ${slug} must exist`);
    assert.equal(card!.industry, "real_estate");
  }
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

/* ------------------------------------------------------------------ */
/* Final Output tests —— 房地产 workflow 最终输出位（当前 placeholder） */
/* ------------------------------------------------------------------ */

test("finalOutputs.main_30s 是房地产 placeholder（不应绑定 mainConceptVideo）", () => {
  const main = finalOutputs.find((o) => o.variant === "main_30s");
  assert.ok(main, "main_30s output must exist");
  assert.equal(
    main!.isPlaceholder,
    true,
    "main_30s 必须是 placeholder —— 房地产最终样片做好后再接入。",
  );
  assert.equal(
    main!.videoUrl,
    null,
    "main_30s.videoUrl 必须为 null：当前没有真实房地产成片可播。",
  );
  assert.notEqual(
    main!.videoUrl,
    mainConceptVideo.url,
    "毛毯概念样片不应被绑定为 North York condo 房地产 final output。",
  );
  assert.ok(
    /coming next|placeholder|示例占位|即将上线|即将接入/i.test(
      `${main!.badge} ${main!.title} ${main!.description}`,
    ),
    "main_30s 必须明确标注为 Coming next / placeholder。",
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
      /coming next|sample variant|placeholder|示例占位|示例预览|即将上线|即将接入/i.test(
        `${o!.badge} ${o!.description}`,
      ),
      `${variant} must visibly be marked as a coming-next / sample variant.`,
    );
  }
});

test("finalOutputs 不应有任何 videoUrl 指向 mainConceptVideo（毛毯不应混入房地产输出位）", () => {
  for (const o of finalOutputs) {
    if (o.videoUrl) {
      assert.notEqual(
        o.videoUrl,
        mainConceptVideo.url,
        `finalOutputs.${o.variant} 错误地把毛毯概念样片绑定为房地产最终输出。`,
      );
    }
  }
});

/* ------------------------------------------------------------------ */
/* Local Product Sample tests —— 案例 B · 本地毛毯 / 家居用品商家       */
/* ------------------------------------------------------------------ */

test("localProductSample 存在，并指向 mainConceptVideo 真实样片", () => {
  assert.ok(localProductSample, "localProductSample must be exported");
  assert.equal(localProductSample.isPlaceholder, false);
  assert.equal(
    localProductSample.videoUrl,
    mainConceptVideo.url,
    "localProductSample.videoUrl 必须指向 mainConceptVideo.url（同一文件）。",
  );
  assert.ok(
    localProductSample.industryLabel.length > 0,
    "industryLabel 不能为空",
  );
  assert.ok(localProductSample.title.length > 0, "title 不能为空");
  assert.ok(
    localProductSample.description.length > 0,
    "description 不能为空",
  );
  assert.ok(
    localProductSample.cta.length > 0,
    "cta 不能为空，作为本地商家方向标语",
  );
});

test("localProductSample timeline 至少 5 个片段（建议 6 段：痛点 / 材质 / 场景 / 卖点 / 产品 / CTA）", () => {
  assert.ok(
    localProductSample.beats.length >= 5,
    `localProductSample.beats 至少 5 段，目前 ${localProductSample.beats.length}`,
  );
  for (const beat of localProductSample.beats) {
    assert.ok(beat.time.length > 0, "beat.time 不能为空");
    assert.ok(beat.label.length > 0, "beat.label 不能为空");
    assert.ok(beat.visual.length > 0, "beat.visual 不能为空");
  }
});

test("localProductSample.videoUrl 是本地 /generated/ 或外链（不允许第三方私域路径）", () => {
  const url = localProductSample.videoUrl;
  assert.ok(url, "localProductSample.videoUrl 不能为空");
  const isLocalGenerated = /^\/generated\//.test(url);
  const isExternal = /^https?:\/\//i.test(url);
  assert.ok(
    isLocalGenerated || isExternal,
    `localProductSample.videoUrl 必须是 /generated/* 或 http(s) URL，得到 ${url}`,
  );
});

test("demoProject has industry/goal/platforms populated（房地产 workflow 输入未被改坏）", () => {
  assert.ok(demoProject.industry);
  assert.ok(demoProject.goalLabel);
  assert.ok(demoProject.platforms.length >= 1);
  assert.equal(
    demoProject.industry,
    "real_estate",
    "demoProject 仍是房地产案例 A 的输入示例。",
  );
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
 * REFERENCE_COMPLIANCE_TEXT），因为这些 disclaimer 会以否定形式（"we do NOT
 * rehost third-party videos"）合法出现，禁词扫描不应误报它们。
 */
function allMarketingDemoStrings(): string[] {
  const out: string[] = [];
  collectStrings(creativeEvidenceCards, out);
  collectStrings(referencePreviews, out);
  collectStrings(generatedScript, out);
  collectStrings(storyboardShots, out);
  collectStrings(assetQAResults, out);
  collectStrings(finalOutputs, out);
  collectStrings(localProductSample, out);
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
/* 案例叙事一致性 ——「毛毯 ≠ 宠物美容 ≠ 房地产成片」                   */
/* ------------------------------------------------------------------ */

const RETIRED_PET_GROOMING_PHRASES: ReadonlyArray<string> = [
  "宠物美容",
  "洗护前",
  "洗护后",
  "洗澡",
  "吹毛",
  "修剪",
  "给毛孩子",
];

const DEMO_NARRATIVE_FILES_TO_SCAN: ReadonlyArray<string> = [
  "src/app/demo/real-footage-ads/page.tsx",
  "src/app/demo/real-footage-ads/experience-client.tsx",
  "src/components/demo/demo-hero.tsx",
  "src/components/demo/final-output-section.tsx",
  "src/components/demo/local-product-sample-section.tsx",
  "src/components/demo/storyboard-grid.tsx",
  "src/lib/demo/ai-video-workflow-demo-data.ts",
];

test("demo 页面叙事不再出现宠物美容相关旧文案", () => {
  const repoRoot = process.cwd();
  for (const rel of DEMO_NARRATIVE_FILES_TO_SCAN) {
    const full = join(repoRoot, rel);
    if (!existsSync(full)) continue;
    const content = readFileSync(full, "utf8");
    for (const phrase of RETIRED_PET_GROOMING_PHRASES) {
      assert.ok(
        !content.includes(phrase),
        `Retired pet-grooming phrase "${phrase}" reappeared in ${rel}. ` +
          "本地毛毯样片 section 不应再出现宠物美容文案。",
      );
    }
  }
});

test("demo 页面叙事不应把毛毯视频文案误当作房地产 final video", () => {
  const repoRoot = process.cwd();
  const positiveAssertionPattern =
    /(?:这条|当前|此条|此款)[^。！？]{0,40}(north\s*york\s*condo[^。！？]{0,40}(?:最终|final))/i;
  const englishOverclaim = /north york condo final video/i;
  for (const rel of DEMO_NARRATIVE_FILES_TO_SCAN) {
    const full = join(repoRoot, rel);
    if (!existsSync(full)) continue;
    const content = readFileSync(full, "utf8");
    assert.ok(
      !positiveAssertionPattern.test(content),
      `${rel} 中出现了把毛毯视频积极描述为「North York condo 最终成片」的句子。`,
    );
    assert.ok(
      !englishOverclaim.test(content),
      `${rel} 中出现了 "North York Condo final video" 这种把毛毯视频误当成房地产成片的英文文案。`,
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
  "全自动大片",
  "保证爆款",
  "一键生成最终商业广告",
];

const DEMO_PAGE_FILES_TO_SCAN: ReadonlyArray<string> = [
  "src/app/demo/real-footage-ads/page.tsx",
  "src/app/demo/real-footage-ads/experience-client.tsx",
  "src/components/demo/demo-hero.tsx",
  "src/components/demo/final-output-section.tsx",
  "src/components/demo/local-product-sample-section.tsx",
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
        !content.includes(phrase.toLowerCase()),
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

test("localProductSample.videoUrl 必须是本地 /generated/* 或外链", () => {
  const url = localProductSample.videoUrl;
  const safe =
    REMOTE_URL_RE.test(url) ||
    SAFE_LOCAL_FILE_PATTERNS.some((p) => p.test(url));
  assert.ok(
    safe,
    `localProductSample.videoUrl ${url} is neither external URL nor a known safe local generated path`,
  );
});

/* ------------------------------------------------------------------ */
/* UI source regression —— Creative Evidence Card selected/score 不重叠 */
/* ------------------------------------------------------------------ */

test("creative-evidence-cards-section: selected badge 和 score chip 在独立容器，没有同一个绝对定位区域", () => {
  const repoRoot = process.cwd();
  const rel = "src/components/demo/creative-evidence-cards-section.tsx";
  const full = join(repoRoot, rel);
  assert.ok(existsSync(full), `${rel} must exist`);
  const content = readFileSync(full, "utf8");

  assert.ok(
    /data-testid="evidence-card-left-badges"/.test(content),
    "selected badge 必须放在带 evidence-card-left-badges testid 的左侧 flex 容器里。",
  );
  assert.ok(
    /data-testid="evidence-card-score-chip"/.test(content),
    "score chip 必须有独立的 evidence-card-score-chip 容器，与 selected 不重叠。",
  );
  assert.ok(
    /data-testid="evidence-card-selected-badge"/.test(content),
    "selected badge 必须有 evidence-card-selected-badge 容器，便于 QA 定位。",
  );
  assert.ok(
    !/absolute\s+right-3\s+top-3[^>]*已选中/.test(content),
    "selected badge 不应再用 `absolute right-3 top-3` 与 score chip 重叠。",
  );
});
