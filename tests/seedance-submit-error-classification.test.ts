import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { submitSeedanceJob } from "../src/lib/providers/seedance";
import { ProviderSubmissionError } from "../src/lib/video-generation/providers/submission-error";

function installRealSubmitRuntime(t: TestContext) {
  const env = {
    VIDEO_ENGINE_MOCK: "false",
    AIVORA_DRY_RUN: "0",
    BYTEPLUS_ARK_API_KEY: "test-key-not-real",
    ARK_BASE_URL: "https://ark.ap-southeast.bytepluses.com/api/v3",
  } as const;
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  t.after(() => {
    for (const key of Object.keys(env)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function stubFetch(
  t: TestContext,
  implementation: typeof fetch,
): void {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = original;
  });
}

async function submitFixture() {
  return submitSeedanceJob({
    prompt: "show the supplied product without changing it",
    duration: 5,
    ratio: "9:16",
  });
}

test("Seedance 401: authentication rejection is definitely_not_created", async (t) => {
  installRealSubmitRuntime(t);
  stubFetch(
    t,
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "AuthenticationError",
            message: "sensitive provider detail must not escape",
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
  );

  await assert.rejects(submitFixture, (error: unknown) => {
    assert.ok(error instanceof ProviderSubmissionError);
    assert.equal(error.providerId, "byteplus");
    assert.equal(error.stage, "provider_response");
    assert.equal(error.httpStatus, 401);
    assert.equal(error.code, "AuthenticationError");
    assert.equal(error.disposition, "definitely_not_created");
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /sensitive provider detail/i);
    return true;
  });
});

test("Seedance unknown 4xx: unsafe details are hidden and disposition stays unknown", async (t) => {
  installRealSubmitRuntime(t);
  stubFetch(
    t,
    async () =>
      new Response(
        JSON.stringify({ error: { code: "invalid code with spaces", message: "secret" } }),
        { status: 422 },
      ),
  );

  await assert.rejects(submitFixture, (error: unknown) => {
    assert.ok(error instanceof ProviderSubmissionError);
    assert.equal(error.httpStatus, 422);
    assert.equal(error.code, undefined);
    assert.equal(error.disposition, "acknowledgement_unknown");
    assert.doesNotMatch(error.message, /invalid code|secret/i);
    return true;
  });
});

test("Seedance 403: authorization rejection is definitely_not_created", async (t) => {
  installRealSubmitRuntime(t);
  stubFetch(
    t,
    async () =>
      new Response(JSON.stringify({ error: { code: "AccessDenied" } }), {
        status: 403,
      }),
  );

  await assert.rejects(submitFixture, (error: unknown) => {
    assert.ok(error instanceof ProviderSubmissionError);
    assert.equal(error.httpStatus, 403);
    assert.equal(error.code, "AccessDenied");
    assert.equal(error.disposition, "definitely_not_created");
    assert.equal(error.retryable, false);
    return true;
  });
});

for (const status of [408, 409, 429]) {
  test(`Seedance ${status}: ambiguous 4xx remains acknowledgement_unknown`, async (t) => {
    installRealSubmitRuntime(t);
    stubFetch(
      t,
      async () =>
        new Response(JSON.stringify({ error: { code: "AmbiguousError" } }), {
          status,
        }),
    );

    await assert.rejects(submitFixture, (error: unknown) => {
      assert.ok(error instanceof ProviderSubmissionError);
      assert.equal(error.httpStatus, status);
      assert.equal(error.disposition, "acknowledgement_unknown");
      assert.equal(error.retryable, false);
      return true;
    });
  });
}

test("Seedance 5xx: provider 响应仍保持 acknowledgement_unknown", async (t) => {
  installRealSubmitRuntime(t);
  stubFetch(
    t,
    async () =>
      new Response(JSON.stringify({ error: { code: "InternalError" } }), {
        status: 503,
      }),
  );

  await assert.rejects(submitFixture, (error: unknown) => {
    assert.ok(error instanceof ProviderSubmissionError);
    assert.equal(error.stage, "provider_response");
    assert.equal(error.httpStatus, 503);
    assert.equal(error.code, "InternalError");
    assert.equal(error.disposition, "acknowledgement_unknown");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("Seedance timeout: transport failure remains acknowledgement_unknown", async (t) => {
  installRealSubmitRuntime(t);
  stubFetch(t, async () => {
    throw new DOMException("timed out", "TimeoutError");
  });

  await assert.rejects(submitFixture, (error: unknown) => {
    assert.ok(error instanceof ProviderSubmissionError);
    assert.equal(error.stage, "transport");
    assert.equal(error.disposition, "acknowledgement_unknown");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("Seedance 2xx decode/missing task id: both remain acknowledgement_unknown", async (t) => {
  installRealSubmitRuntime(t);
  let responseIndex = 0;
  stubFetch(t, async () => {
    responseIndex += 1;
    return responseIndex === 1
      ? new Response("not-json", { status: 200 })
      : new Response(JSON.stringify({ status: "queued" }), { status: 200 });
  });

  for (const expectedCause of ["无法解码", "未携带任务 ID"]) {
    await assert.rejects(submitFixture, (error: unknown) => {
      assert.ok(error instanceof ProviderSubmissionError);
      assert.equal(error.stage, "response_decode");
      assert.equal(error.httpStatus, 200);
      assert.equal(error.disposition, "acknowledgement_unknown");
      assert.match(error.message, new RegExp(expectedCause));
      return true;
    });
  }
});
