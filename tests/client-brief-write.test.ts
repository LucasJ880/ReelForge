import assert from "node:assert/strict";
import test from "node:test";
import {
  parseClientBrief,
  parseClientBriefPatch,
} from "../src/lib/schemas/client-brief";

/**
 * 这一组测试不连数据库，只验证：write 路径必须 zod parse，partial parse 会拒绝非法字段。
 *
 * 真正涉及 DB 的写入路径（writeClientBriefToOrder / requireClientBrief）在集成测试覆盖；
 * 这里通过单元测试为 zod 闸门兜底，确保 wizard API 不会偷偷把脏 JSON 塞进 clientBrief。
 */

const validBrief = {
  businessName: "Sunrise Realty",
  industry: "real_estate" as const,
  objective: "promote_listing" as const,
  targetPlatforms: ["tiktok"] as const,
  videoLengthSec: 30 as const,
  brandTone: "professional" as const,
  brandAssets: { ctaText: "DM for tour" },
  candidateCardSlugs: [],
  consents: {
    ownsFootage: true,
    noUnauthorizedAvatar: true,
    noUnauthorizedVoiceClone: true,
  },
};

test("parseClientBrief accepts valid brief", () => {
  const out = parseClientBrief(validBrief);
  assert.equal(out.businessName, "Sunrise Realty");
});

test("parseClientBrief rejects missing required field", () => {
  const { businessName: _ignore, ...rest } = validBrief;
  void _ignore;
  assert.throws(() => parseClientBrief(rest as unknown));
});

test("parseClientBriefPatch accepts partial patches", () => {
  const out = parseClientBriefPatch({ keyMessage: "Spring open house this weekend" });
  assert.equal(out.keyMessage, "Spring open house this weekend");
  assert.equal(Object.keys(out).length, 1);
});

test("parseClientBriefPatch strips unknown fields safely (zod default behavior)", () => {
  /// zod 默认会忽略多余 key（除非 schema strict()），但不应保留它们
  const dirtyInput = {
    keyMessage: "ok",
    maliciousScript: "<img onerror=alert(1)>",
  } as unknown as Record<string, unknown>;
  const out = parseClientBriefPatch(dirtyInput);
  assert.equal((out as Record<string, unknown>).maliciousScript, undefined);
});

test("parseClientBriefPatch rejects malformed enum value", () => {
  assert.throws(() =>
    parseClientBriefPatch({
      industry: "totally_invalid_industry" as unknown as never,
    }),
  );
});

test("parseClientBriefPatch rejects malformed videoLengthSec", () => {
  assert.throws(() =>
    parseClientBriefPatch({
      videoLengthSec: 999 as unknown as never,
    }),
  );
});
