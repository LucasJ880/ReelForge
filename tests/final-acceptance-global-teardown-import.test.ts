import assert from "node:assert/strict";
import test from "node:test";

test("final-acceptance global teardown imports without registering Playwright hooks", async () => {
  const teardownModule = await import(
    "./final-acceptance/global-teardown"
  );

  assert.equal(typeof teardownModule.default, "function");
});
