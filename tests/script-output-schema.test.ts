import assert from "node:assert/strict";
import test from "node:test";
import { parseScriptOutput } from "../src/lib/schemas/script-output";
import {
  mockClientScript,
} from "../src/lib/prompts/client-script";
import { parseClientBrief } from "../src/lib/schemas/client-brief";

const brief = parseClientBrief({
  businessName: "Aivora Bistro",
  industry: "restaurant",
  objective: "increase_bookings",
  targetPlatforms: ["tiktok"],
  videoLengthSec: 15,
  brandTone: "warm",
  brandAssets: { ctaText: "Book a table tonight" },
  candidateCardSlugs: [],
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
});

test("ScriptOutput accepts mock script payload", () => {
  const mock = mockClientScript({ brief });
  const parsed = parseScriptOutput(mock);
  assert.equal(parsed.copiedFromReference, false);
  assert.ok(parsed.voiceover.length > 10);
  assert.ok(parsed.captions.length >= 1);
});

test("ScriptOutput rejects copiedFromReference=true", () => {
  const bad = {
    ...mockClientScript({ brief }),
    copiedFromReference: true,
  };
  assert.throws(() => parseScriptOutput(bad), /Script LLM 输出无效/);
});

test("ScriptOutput requires non-empty hook and CTA", () => {
  const mock = mockClientScript({ brief });
  assert.throws(
    () =>
      parseScriptOutput({
        ...mock,
        hook: "",
      }),
    /Script LLM 输出无效/,
  );
});

test("mockClientScript includes industry-specific compliance notes for real estate", () => {
  const realEstateBrief = parseClientBrief({
    ...brief,
    industry: "real_estate",
    objective: "promote_listing",
  });
  const mock = mockClientScript({ brief: realEstateBrief });
  assert.ok(
    mock.complianceNotes.some((note) => /Equal Housing/.test(note)),
    "real estate scripts should ship Equal Housing disclaimer",
  );
});
