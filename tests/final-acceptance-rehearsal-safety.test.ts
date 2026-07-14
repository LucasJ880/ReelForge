import assert from "node:assert/strict";
import test from "node:test";
import { assertFinalAcceptanceRehearsal } from "./final-acceptance/rehearsal-safety";

const REHEARSAL_URL = "postgresql://rehearsal.invalid/aivora";

test("final acceptance seed: missing rehearsal opt-in fails closed", () => {
  assert.throws(
    () =>
      assertFinalAcceptanceRehearsal({
        DATABASE_URL: REHEARSAL_URL,
        NEON_REHEARSAL_DATABASE_URL: REHEARSAL_URL,
      }),
    /显式 rehearsal/,
  );
});

test("final acceptance seed: mismatched database URLs fail closed", () => {
  assert.throws(
    () =>
      assertFinalAcceptanceRehearsal({
        FINAL_ACCEPTANCE_REQUIRE_REHEARSAL: "true",
        DATABASE_URL: "postgresql://production.invalid/aivora",
        NEON_REHEARSAL_DATABASE_URL: REHEARSAL_URL,
      }),
    /完全一致/,
  );
});

test("final acceptance seed: exact rehearsal URL match is accepted", () => {
  assert.equal(
    assertFinalAcceptanceRehearsal({
      FINAL_ACCEPTANCE_REQUIRE_REHEARSAL: "true",
      DATABASE_URL: REHEARSAL_URL,
      NEON_REHEARSAL_DATABASE_URL: REHEARSAL_URL,
    }),
    REHEARSAL_URL,
  );
});
