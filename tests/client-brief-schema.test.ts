import assert from "node:assert/strict";
import test from "node:test";
import {
  parseClientBrief,
  parseClientBriefPatch,
} from "../src/lib/schemas/client-brief";

const validBrief = {
  businessName: "Maple Pet Co.",
  industry: "pet_business" as const,
  objective: "increase_bookings" as const,
  targetPlatforms: ["tiktok", "instagram_reels"] as const,
  videoLengthSec: 30 as const,
  brandTone: "warm" as const,
  brandAssets: {
    primaryColor: "#1E40AF",
    websiteUrl: "https://example.com/maple",
    ctaText: "Book grooming this week",
  },
  candidateCardSlugs: ["pet-grooming-before-after"],
  selectedCardSlug: "pet-grooming-before-after",
  keyMessage: "We are the only certified groomer within 3 km",
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
};

test("ClientBrief accepts a fully populated wizard payload", () => {
  const parsed = parseClientBrief(validBrief);
  assert.equal(parsed.businessName, "Maple Pet Co.");
  assert.equal(parsed.videoLengthSec, 30);
  assert.equal(parsed.brandAssets.primaryColor, "#1E40AF");
});

test("ClientBrief rejects unsupported video length", () => {
  assert.throws(
    () => parseClientBrief({ ...validBrief, videoLengthSec: 22 as never }),
    /ClientBrief 校验失败/,
  );
});

test("ClientBrief rejects unknown industry", () => {
  assert.throws(
    () => parseClientBrief({ ...validBrief, industry: "saas" as never }),
    /ClientBrief 校验失败/,
  );
});

test("ClientBrief rejects malformed primaryColor", () => {
  assert.throws(
    () =>
      parseClientBrief({
        ...validBrief,
        brandAssets: { ...validBrief.brandAssets, primaryColor: "not-a-color" },
      }),
    /ClientBrief 校验失败/,
  );
});

test("ClientBriefPatch allows partial updates", () => {
  const patch = parseClientBriefPatch({
    selectedCardSlug: "pet-product-shelf-walkthrough",
  });
  assert.equal(patch.selectedCardSlug, "pet-product-shelf-walkthrough");
  assert.equal(patch.businessName, undefined);
});
