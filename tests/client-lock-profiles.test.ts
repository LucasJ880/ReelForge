import assert from "node:assert/strict";
import test from "node:test";
import {
  SUNNYSHUTTER_CLIENT_LOCK_ID,
  clientLockCommerceProductProfile,
  resolveClientLockProfile,
  usesSunnyShutterLocks,
} from "../src/lib/video-generation/client-lock-profiles";

test("explicit sunnyshutter ids resolve", () => {
  assert.equal(
    resolveClientLockProfile({ clientLockProfileId: "sunnyshutter" }),
    SUNNYSHUTTER_CLIENT_LOCK_ID,
  );
  assert.equal(
    resolveClientLockProfile({ clientLockProfileId: "sunny-shutter" }),
    SUNNYSHUTTER_CLIENT_LOCK_ID,
  );
});

test("brand / email heuristics match SunnyShutter only", () => {
  assert.equal(
    resolveClientLockProfile({ brandName: "SUNNY Shutters" }),
    SUNNYSHUTTER_CLIENT_LOCK_ID,
  );
  assert.equal(
    resolveClientLockProfile({ merchantEmail: "sunny-shutter@aivora.test" }),
    SUNNYSHUTTER_CLIENT_LOCK_ID,
  );
  assert.equal(
    resolveClientLockProfile({ brandName: "Acme Blinds", productName: "plantation shutters" }),
    null,
  );
  assert.equal(resolveClientLockProfile({}), null);
});

test("usesSunnyShutterLocks is true only for that profile", () => {
  assert.equal(usesSunnyShutterLocks("sunnyshutter"), true);
  assert.equal(usesSunnyShutterLocks(null), false);
});

test("SunnyShutter profile adds product facts without replacing generic policy", () => {
  const profile = clientLockCommerceProductProfile(
    SUNNYSHUTTER_CLIENT_LOCK_ID,
  );
  assert.ok(profile);
  assert.equal(profile.productType, "plantation shutters");
  assert.ok(profile.identityLocks.some((lock) => /louver width/i.test(lock)));
  assert.ok(
    profile.demonstrableActions.includes(
      "tilt all louvers together with no hands visible",
    ),
  );
  assert.equal(clientLockCommerceProductProfile(null), null);
});
