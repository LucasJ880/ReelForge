import test from "node:test";
import assert from "node:assert/strict";
import { defaultBrandPackageId } from "../src/lib/brand/default-brand-package";

test("创作页默认选中默认品牌包；只有一个时选它；多个无默认时留空", () => {
  assert.equal(defaultBrandPackageId([]), null);
  assert.equal(defaultBrandPackageId([{ id: "a", isDefault: false }]), "a");
  assert.equal(
    defaultBrandPackageId([
      { id: "a", isDefault: false },
      { id: "b", isDefault: true },
    ]),
    "b",
  );
  assert.equal(
    defaultBrandPackageId([
      { id: "a", isDefault: false },
      { id: "b", isDefault: false },
    ]),
    null,
  );
});
