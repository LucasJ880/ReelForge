import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShootingGuideFromStoryboard,
} from "../src/lib/prompts/shooting-guide";
import {
  parseShootingGuideDoc,
  type ShootingGuideItem,
} from "../src/lib/schemas/shooting-guide";
import { parseStoryboardOutput } from "../src/lib/schemas/storyboard";
import { parseClientBrief } from "../src/lib/schemas/client-brief";

const brief = parseClientBrief({
  businessName: "Northside Real Estate",
  industry: "real_estate",
  objective: "promote_listing",
  targetPlatforms: ["tiktok"],
  videoLengthSec: 30,
  brandTone: "professional",
  brandAssets: { ctaText: "DM for tour" },
  candidateCardSlugs: [],
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
});

const storyboard = parseStoryboardOutput({
  totalDurationSec: 30,
  shots: [
    {
      sceneIndex: 1,
      durationSec: 5,
      shotType: "establishing",
      visualIntent: "Wide exterior of the listing",
      whatToFilm: "门口推近，露出招牌",
      composition: "rule_of_thirds",
      cameraMovement: "push_in",
      orientation: "portrait",
      requiredFlag: true,
      humanRequired: false,
      requiredProps: ["招牌"],
      captionText: "123 Maple St · $750k",
      voiceoverSegment: "POV: 站在 Maple Street 的门口...",
    },
    {
      sceneIndex: 2,
      durationSec: 18,
      shotType: "medium",
      visualIntent: "Walkthrough of living, kitchen, master",
      whatToFilm: "依次拍客厅、厨房、主卧",
      composition: "centered",
      cameraMovement: "tracking",
      orientation: "portrait",
      requiredFlag: true,
      humanRequired: false,
      requiredProps: ["室内"],
      captionText: "学区 / 采光 / 储物",
      voiceoverSegment: "三个高光：学区位置、午后采光、整层储物",
    },
    {
      sceneIndex: 3,
      durationSec: 7,
      shotType: "talking_head",
      visualIntent: "Agent CTA with disclaimer",
      whatToFilm: "经纪人本人出镜，露出执照",
      composition: "centered",
      cameraMovement: "static",
      orientation: "portrait",
      requiredFlag: true,
      humanRequired: true,
      requiredProps: ["名片"],
      captionText: "DM for tour · Equal Housing Opportunity",
      voiceoverSegment: "想看房直接私信，本周末有 open house",
    },
  ],
});

test("buildShootingGuideFromStoryboard preserves shot count and required flags", () => {
  const guide = buildShootingGuideFromStoryboard({ storyboard, brief });
  assert.equal(guide.totalShots, storyboard.shots.length);
  assert.equal(guide.requiredShots, 3);
  assert.equal(guide.optionalShots, 0);
  assert.equal(guide.totalDurationSec, 30);
});

test("buildShootingGuideFromStoryboard adds preflight checklist", () => {
  const guide = buildShootingGuideFromStoryboard({ storyboard, brief });
  assert.ok(guide.preflightChecklist.length >= 3);
});

test("buildShootingGuideFromStoryboard injects audio note for human shots", () => {
  const guide = buildShootingGuideFromStoryboard({ storyboard, brief });
  const talkingHead = guide.items.find((i) => i.humanRequired);
  assert.ok(talkingHead);
  assert.match(talkingHead!.audioNote ?? "", /麦克风|领夹麦/);
  assert.ok(talkingHead!.commonMistakes.length > 0);
});

test("buildShootingGuideFromStoryboard puts CTA hint on the last shot", () => {
  const guide = buildShootingGuideFromStoryboard({ storyboard, brief });
  const last = guide.items[guide.items.length - 1];
  assert.ok(last.uploadHints.some((h) => /CTA/.test(h)));
});

test("ShootingGuideDoc round-trips through parseShootingGuideDoc", () => {
  const guide = buildShootingGuideFromStoryboard({ storyboard, brief });
  const parsed = parseShootingGuideDoc(guide);
  assert.equal(parsed.totalShots, guide.totalShots);
  const item: ShootingGuideItem = parsed.items[0];
  assert.equal(item.sceneIndex, 1);
});
