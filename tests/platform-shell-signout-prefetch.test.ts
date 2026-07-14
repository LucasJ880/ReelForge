import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RF-036: protected platform navigation cannot prefetch after sign-out clears auth", async () => {
  const source = await readFile(
    "src/components/platform/platform-shell.tsx",
    "utf8",
  );
  const navStart = source.indexOf("PLATFORM_PRIMARY_NAV.map");
  const navEnd = source.indexOf("</nav>", navStart);

  assert.ok(navStart >= 0 && navEnd > navStart, "platform nav must exist");
  const navSource = source.slice(navStart, navEnd);
  assert.match(navSource, /<Link[\s\S]*?href=\{item\.href\}[\s\S]*?prefetch=\{false\}/);
  assert.doesNotMatch(
    navSource,
    /prefetch=\{(?:true|signingOut\s*\?\s*true)/,
    "protected links must never restart prefetch after auth is cleared",
  );
});
