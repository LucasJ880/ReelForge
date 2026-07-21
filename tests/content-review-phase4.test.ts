import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { __test__, OpenAiModerationProvider } from "../src/lib/content-review/providers/openai-moderation-provider";
import { ContentReviewRejectedError, classifyContentReviewFailure, __resetContentReviewProviderForTests, createContentReviewProvider, reviewMediaOrThrow } from "../src/lib/content-review";
import { __resetAppEnvForTests } from "../src/lib/config/env";

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const old = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  __resetAppEnvForTests(); __resetContentReviewProviderForTests();
  try { return await fn(); }
  finally {
    for (const [key, value] of Object.entries(old)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    __resetAppEnvForTests(); __resetContentReviewProviderForTests();
  }
}

test("OpenAI moderation result maps provider taxonomy and score", () => {
  const result = __test__.mapResult("mod_1", { flagged: true, categories: { violence: true, sexual: false }, category_scores: { violence: 0.84, sexual: 0.02 } });
  assert.equal(result.verdict, "rejected");
  assert.deepEqual(result.categories, ["violence"]);
  assert.equal(result.score, 84);
});

test("mock moderation is approved without a key and factory selects OpenAI", async () => {
  await withEnv({ CONTENT_REVIEW_ENABLED: "true", CONTENT_REVIEW_PROVIDER: "openai_moderation", CONTENT_REVIEW_MOCK: "true", OPENAI_API_KEY: undefined }, async () => {
    const provider = createContentReviewProvider();
    assert.equal(provider.id, "openai_moderation");
    assert.equal((await provider.reviewText({ kind: "generation_prompt", text: "mock" })).verdict, "approved");
  });
});

test("real mode with no key fails closed", async () => {
  await withEnv({ CONTENT_REVIEW_MOCK: "false", LLM_FORCE_MOCK: "false", OPENAI_API_KEY: undefined }, async () => {
    const provider = new OpenAiModerationProvider();
    assert.equal((await provider.reviewText({ kind: "generation_prompt", text: "test" })).verdict, "failed_closed");
  });
});

test("video without a reviewed frame cannot pass real-mode delivery", async () => {
  await withEnv({ CONTENT_REVIEW_ENABLED: "true", CONTENT_REVIEW_PROVIDER: "openai_moderation", CONTENT_REVIEW_MOCK: "false", LLM_FORCE_MOCK: "false", OPENAI_API_KEY: "test-only-key" }, async () => {
    await assert.rejects(() => reviewMediaOrThrow({ kind: "generated_video", mediaUrl: "https://example.test/video.mp4", mediaType: "video" }), ContentReviewRejectedError);
  });
});

test("only a genuine rejection is classified as content_blocked", () => {
  const rejected = new ContentReviewRejectedError("user_upload", {
    verdict: "rejected",
    categories: ["violence"],
  });
  assert.equal(rejected.isContentGenuinelyBlocked, true);
  assert.equal(classifyContentReviewFailure(rejected), "content_blocked");

  for (const verdict of ["failed_closed", "failed_open", "manual_review"] as const) {
    const err = new ContentReviewRejectedError("user_upload", { verdict });
    assert.equal(err.isContentGenuinelyBlocked, false, verdict);
    assert.equal(classifyContentReviewFailure(err), "review_unavailable", verdict);
  }

  // 非审核异常（未知瞬时故障）也不能当成用户素材违规
  assert.equal(classifyContentReviewFailure(new Error("boom")), "review_unavailable");
});

test("upload boundary maps provider-unavailable to a retryable error, not replace_asset", async () => {
  const source = await readFile("src/app/api/upload/blob/route.ts", "utf8");
  // provider 故障分支必须走可重试的 SERVICE_UNAVAILABLE，且只有真违规才 replace_asset
  assert.match(source, /classifyContentReviewFailure/);
  assert.match(source, /content review unavailable/);
  assert.match(source, /SERVICE_UNAVAILABLE/);
});

test("three Phase 4 review boundaries are wired", async () => {
  const [upload, submit, finalize] = await Promise.all([
    readFile("src/app/api/upload/blob/route.ts", "utf8"),
    readFile("src/lib/providers/seedance.ts", "utf8"),
    readFile("src/lib/services/stitch-service.ts", "utf8"),
  ]);
  assert.match(upload, /reviewMediaOrThrow/);
  assert.match(submit, /reviewTextOrThrow/);
  assert.match(finalize, /reviewGeneratedVideo/);
  assert.match(finalize, /reviewMediaOrThrow/);
});
