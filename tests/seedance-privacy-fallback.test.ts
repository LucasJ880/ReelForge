import assert from "node:assert/strict";
import { test } from "node:test";

import { isSeedancePrivacyBlockError } from "../src/lib/providers/seedance";

test("isSeedancePrivacyBlockError detects Volcengine privacy codes", () => {
  assert.equal(
    isSeedancePrivacyBlockError(
      "InputImageSensitiveContentDetected.PrivacyInformation: real person",
    ),
    true,
  );
  assert.equal(isSeedancePrivacyBlockError("network timeout"), false);
});
