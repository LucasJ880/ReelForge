import assert from "node:assert/strict";
import test from "node:test";
import {
  checkStoryboardDurationConsistency,
  parseStoryboardOutput,
} from "../src/lib/schemas/storyboard";
import { mockStoryboard } from "../src/lib/prompts/storyboard";
import { mockClientScript } from "../src/lib/prompts/client-script";
import { parseClientBrief } from "../src/lib/schemas/client-brief";

const brief = parseClientBrief({
  businessName: "Sunset Pet Spa",
  industry: "pet_business",
  objective: "increase_bookings",
  targetPlatforms: ["tiktok"],
  videoLengthSec: 30,
  brandTone: "warm",
  brandAssets: { ctaText: "DM to book grooming" },
  candidateCardSlugs: [],
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
});

const script = mockClientScript({ brief });

test("Storyboard mock output validates with schema and has 3 shots", () => {
  const story = mockStoryboard({ brief, script });
  const parsed = parseStoryboardOutput(story);
  assert.equal(parsed.shots.length, 3);
  assert.equal(parsed.totalDurationSec, 30);
});

test("checkStoryboardDurationConsistency returns no issues for matching mock", () => {
  const story = parseStoryboardOutput(mockStoryboard({ brief, script }));
  const issues = checkStoryboardDurationConsistency(story, brief.videoLengthSec);
  assert.equal(issues.length, 0);
});

test("checkStoryboardDurationConsistency surfaces 5s mismatch", () => {
  const story = parseStoryboardOutput(mockStoryboard({ brief, script }));
  const issues = checkStoryboardDurationConsistency(
    {
      ...story,
      totalDurationSec: story.totalDurationSec + 5,
    },
    brief.videoLengthSec,
  );
  assert.ok(issues.length > 0);
  assert.ok(
    issues.some((i) => /不一致/.test(i)),
    "should surface internal duration inconsistency",
  );
});

test("Storyboard schema rejects shots with sceneIndex 0", () => {
  const story = mockStoryboard({ brief, script });
  assert.throws(
    () =>
      parseStoryboardOutput({
        ...story,
        shots: [{ ...story.shots[0], sceneIndex: 0 }, ...story.shots.slice(1)],
      }),
    /Storyboard LLM 输出无效/,
  );
});
