import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCreativeEvidenceCardCore,
  parseCreativeEvidenceBreakdown,
} from "../src/lib/schemas/creative-evidence";

const validCard = {
  slug: "real-estate-listing-walkthrough-pov",
  title: "POV listing walkthrough · 30s",
  industry: "real_estate" as const,
  platform: "tiktok" as const,
  objective: "promote_listing" as const,
  publicMetrics: {
    observedAt: "demo-seed",
    views: 482000,
    likes: 38900,
  },
  hookPattern: {
    pattern: "POV: 推门 + 大字幕地段 + 总价",
    openingSeconds: 3,
    hookType: "POV" as const,
    whyItStops: "潜在买家最关心的两件事被一次性给出",
  },
  structureBreakdown: {
    segments: [
      { from: 0, to: 3, role: "hook" as const, narrative: "POV 推门" },
      { from: 3, to: 30, role: "demo" as const, narrative: "户型连续走" },
    ],
  },
  whyItWorks: "POV 让买家代入感最强，符合短视频快判断节奏",
  visualStyle: "竖屏 9:16，自然光",
  suggestedUseCase: "新挂牌房源",
  recommendationScore: 88,
  clientPreviewSummary: "适合在售房源在挂牌前 7 天用，把房源送到本地买家眼前。",
  status: "PUBLISHED" as const,
};

test("CreativeEvidenceCard schema accepts a complete valid card", () => {
  const parsed = parseCreativeEvidenceCardCore(validCard);
  assert.equal(parsed.slug, "real-estate-listing-walkthrough-pov");
  assert.equal(parsed.industry, "real_estate");
  assert.equal(parsed.recommendationScore, 88);
});

test("CreativeEvidenceCard schema requires structured slug", () => {
  assert.throws(
    () => parseCreativeEvidenceCardCore({ ...validCard, slug: "Invalid Slug!" }),
    /slug/,
  );
});

test("CreativeEvidenceCard schema rejects invalid hookType", () => {
  assert.throws(
    () =>
      parseCreativeEvidenceCardCore({
        ...validCard,
        hookPattern: {
          ...validCard.hookPattern,
          hookType: "AggressiveHook" as never,
        },
      }),
    /CreativeEvidenceCard 校验失败/,
  );
});

test("CreativeEvidenceBreakdown LLM output requires recommendationScore in 0-100", () => {
  assert.throws(
    () =>
      parseCreativeEvidenceBreakdown({
        hookPattern: validCard.hookPattern,
        structureBreakdown: validCard.structureBreakdown,
        whyItWorks: validCard.whyItWorks,
        visualStyle: validCard.visualStyle,
        suggestedUseCase: validCard.suggestedUseCase,
        clientPreviewSummary: validCard.clientPreviewSummary,
        recommendationScore: 150,
      }),
    /CreativeEvidenceBreakdown LLM 输出无效/,
  );
});

test("CreativeEvidenceBreakdown LLM output accepts mock-shaped payload", () => {
  const parsed = parseCreativeEvidenceBreakdown({
    hookPattern: validCard.hookPattern,
    structureBreakdown: validCard.structureBreakdown,
    whyItWorks: validCard.whyItWorks,
    visualStyle: validCard.visualStyle,
    suggestedUseCase: validCard.suggestedUseCase,
    riskNotes: "fair-housing required",
    clientPreviewSummary: validCard.clientPreviewSummary,
    recommendationScore: 80,
  });
  assert.equal(parsed.recommendationScore, 80);
  assert.equal(parsed.riskNotes, "fair-housing required");
});
